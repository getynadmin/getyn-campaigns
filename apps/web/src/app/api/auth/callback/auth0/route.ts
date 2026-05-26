/* eslint-disable no-console */
import * as Sentry from '@sentry/nextjs';
import { NextResponse, type NextRequest } from 'next/server';

import {
  exchangeCodeForTokens,
  isAuth0Configured,
  verifyIdToken,
} from '@/server/auth/auth0';
import { buildAuth0SessionCookie } from '@/server/auth/auth0-session';
import {
  SsoIdentityConflictError,
  provisionFromSso,
} from '@/server/auth/sso-provision';

/**
 * Phase 5 M1 — Auth0 OAuth callback.
 *
 *   1. Validate state matches the cookie set by /login/auth0.
 *   2. Exchange ?code= for tokens.
 *   3. Verify the ID token via JWKS + Zod-validate the claims.
 *   4. Run provisionFromSso to resolve User + Tenant + Membership
 *      and best-effort sync the plan.
 *   5. Set the Campaigns session cookie, clear the state cookie,
 *      redirect to /t/{slug}/dashboard (or returnTo if same-origin).
 *
 * # Error UX
 * Each failure mode lands on /login with `?error=<code>` so the user
 * sees something explanatory rather than a JSON wall. Sentry captures
 * with tags per failure type.
 */

const STATE_COOKIE = 'getyn_sso_state';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuth0Configured()) {
    return NextResponse.redirect(new URL('/login?error=sso_disabled', req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (errorParam) {
    Sentry.captureMessage('sso callback returned error param', {
      level: 'warning',
      tags: { sso: 'auth0', failure: 'oauth_error' },
      extra: { errorParam, errorDescription },
    });
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorParam)}`, req.url),
    );
  }

  if (!code || !returnedState) {
    return NextResponse.redirect(new URL('/login?error=sso_missing_code', req.url));
  }

  // State cookie must be present + must round-trip the same value.
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie) {
    return NextResponse.redirect(new URL('/login?error=sso_state_missing', req.url));
  }
  let stateBlob: { state: string; nonce: string; returnTo: string | null };
  try {
    stateBlob = JSON.parse(
      Buffer.from(stateCookie, 'base64url').toString('utf8'),
    );
  } catch {
    return NextResponse.redirect(new URL('/login?error=sso_state_malformed', req.url));
  }
  if (stateBlob.state !== returnedState) {
    Sentry.captureMessage('sso state mismatch', {
      level: 'warning',
      tags: { sso: 'auth0', failure: 'state_mismatch' },
    });
    return NextResponse.redirect(new URL('/login?error=sso_state_mismatch', req.url));
  }

  // 2) Token exchange.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { sso: 'auth0', failure: 'token_exchange' },
    });
    return NextResponse.redirect(
      new URL('/login?error=sso_token_exchange', req.url),
    );
  }

  // 3) Verify ID token.
  let claims;
  try {
    claims = await verifyIdToken(tokens.id_token);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { sso: 'auth0', failure: 'id_token_invalid' },
    });
    return NextResponse.redirect(
      new URL('/login?error=sso_id_token_invalid', req.url),
    );
  }

  // 4) Provision User + Tenant + Membership; best-effort plan sync.
  let result;
  try {
    result = await provisionFromSso(claims, {
      returnTo: stateBlob.returnTo,
    });
  } catch (err) {
    if (err instanceof SsoIdentityConflictError) {
      Sentry.captureMessage('sso identity conflict', {
        level: 'warning',
        tags: { sso: 'auth0', failure: 'identity_conflict' },
        extra: { email: claims.email },
      });
      return NextResponse.redirect(
        new URL('/login?error=sso_identity_conflict', req.url),
      );
    }
    Sentry.captureException(err, {
      tags: { sso: 'auth0', failure: 'provisioning' },
      extra: { email: claims.email },
    });
    return NextResponse.redirect(
      new URL('/login?error=sso_provisioning', req.url),
    );
  }

  // 5) Set session cookie + insert UserSession row, clear state
  //    cookie, redirect. The cookie itself carries the sessionToken
  //    that the row holds, so revokes take effect on the next request.
  const sessionCookie = await buildAuth0SessionCookie({
    userId: result.user.id,
    auth0Sub: claims.sub,
    context: {
      userAgent: req.headers.get('user-agent'),
      ipAddress:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    },
  });

  const redirectUrl = new URL(result.redirectTo, req.url);
  if (result.planSyncPending) {
    redirectUrl.searchParams.set('plan_sync', 'pending');
  }
  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set({
    name: sessionCookie.name,
    value: sessionCookie.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionCookie.maxAgeSec,
  });
  res.cookies.delete(STATE_COOKIE);
  return res;
}
