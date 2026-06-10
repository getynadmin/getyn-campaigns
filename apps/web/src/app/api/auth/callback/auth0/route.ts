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

type StateBlob = {
  state: string;
  nonce: string;
  returnTo: string | null;
  silent?: boolean;
};

/**
 * Return either a 302 redirect (regular login flow) or a tiny HTML
 * document with a postMessage payload (silent SSO flow inside a
 * hidden iframe).
 */
function failure(req: NextRequest, silent: boolean, code: string): NextResponse {
  if (silent) {
    return silentHtml({ ok: false, reason: code });
  }
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(code)}`, req.url),
  );
}

function silentHtml(args: {
  ok: boolean;
  reason?: string;
  redirectTo?: string;
}): NextResponse {
  const body = `<!doctype html><meta charset="utf-8"><title>SSO</title><script>(function(){try{window.parent.postMessage(${JSON.stringify(
    {
      type: 'getyn-silent-sso',
      ok: args.ok,
      reason: args.reason ?? null,
      redirectTo: args.redirectTo ?? null,
    },
  )}, '*');}catch(e){}})();</script>`;
  return new NextResponse(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Best-effort silent flag detection BEFORE we trust the state
  // cookie — Auth0 errors out before our state round-trip on
  // login_required, but we still want to render HTML if this was
  // a silent probe. The state cookie carries the authoritative flag.
  const stateCookieRaw = req.cookies.get(STATE_COOKIE)?.value;
  let stateBlob: StateBlob | null = null;
  if (stateCookieRaw) {
    try {
      stateBlob = JSON.parse(
        Buffer.from(stateCookieRaw, 'base64url').toString('utf8'),
      );
    } catch {
      stateBlob = null;
    }
  }
  const silent = stateBlob?.silent === true;

  if (!isAuth0Configured()) {
    return failure(req, silent, 'sso_disabled');
  }

  if (errorParam) {
    // login_required / consent_required / interaction_required all
    // mean "no IdP session" — exactly the expected outcome of a
    // silent probe with no session. Don't log to Sentry in that
    // case; log only when something genuinely went wrong.
    const expectedSilent =
      silent &&
      (errorParam === 'login_required' ||
        errorParam === 'consent_required' ||
        errorParam === 'interaction_required');
    if (!expectedSilent) {
      Sentry.captureMessage('sso callback returned error param', {
        level: 'warning',
        tags: { sso: 'auth0', failure: 'oauth_error', silent: String(silent) },
        extra: { errorParam, errorDescription },
      });
    }
    const res = failure(req, silent, errorParam);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  if (!code || !returnedState) {
    return failure(req, silent, 'sso_missing_code');
  }

  if (!stateBlob) {
    return failure(req, silent, 'sso_state_missing');
  }
  if (stateBlob.state !== returnedState) {
    Sentry.captureMessage('sso state mismatch', {
      level: 'warning',
      tags: { sso: 'auth0', failure: 'state_mismatch' },
    });
    return failure(req, silent, 'sso_state_mismatch');
  }

  // 2) Token exchange.
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { sso: 'auth0', failure: 'token_exchange' },
    });
    return failure(req, silent, 'sso_token_exchange');
  }

  // 3) Verify ID token.
  let claims;
  try {
    claims = await verifyIdToken(tokens.id_token);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { sso: 'auth0', failure: 'id_token_invalid' },
    });
    return failure(req, silent, 'sso_id_token_invalid');
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
      return failure(req, silent, 'sso_identity_conflict');
    }
    Sentry.captureException(err, {
      tags: { sso: 'auth0', failure: 'provisioning' },
      extra: { email: claims.email },
    });
    return failure(req, silent, 'sso_provisioning');
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

  // Silent success: write the cookie + return HTML that tells the
  // parent page to navigate. Same-Site=Lax means the cookie WILL
  // be sent on the next top-level navigation, so the parent picks
  // it up when window.parent.location is set.
  const res = silent
    ? silentHtml({ ok: true, redirectTo: redirectUrl.toString() })
    : NextResponse.redirect(redirectUrl);
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
