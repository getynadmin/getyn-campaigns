/* eslint-disable no-console */
import { randomBytes } from 'crypto';

import { NextResponse, type NextRequest } from 'next/server';

import {
  buildAuth0LoginUrl,
  isAuth0Configured,
} from '@/server/auth/auth0';

/**
 * Phase 5 M1 — initiate Auth0 OAuth.
 *
 * Generates a CSRF-resistant state token, stores it in a short-lived
 * cookie, redirects to Auth0's /authorize. The callback route
 * compares the round-tripped state against the cookie.
 *
 * `?return_to=/some-path` is honored if same-origin (validated at
 * callback time). Stored alongside the state token so it survives
 * the redirect round-trip without leaking via Auth0's logs.
 */

const STATE_COOKIE = 'getyn_sso_state';
const STATE_TTL_SEC = 600; // 10 min — generous; some IdPs slow

/**
 * Resolve the public origin from x-forwarded-* headers (set by
 * Vercel's edge to the actual domain the user hit), falling back
 * to the URL the handler was invoked with. Mirrors the same fix
 * applied to /api/auth/logout and the admin webhook-URL hints —
 * env-var-only resolution failed on Vercel because the system
 * vars (APP_BASE_URL, NEXT_PUBLIC_APP_URL, VERCEL_URL,
 * VERCEL_PROJECT_PRODUCTION_URL) aren't all populated in every
 * runtime context.
 */
function originFromRequest(req: NextRequest): string {
  const proto =
    req.headers.get('x-forwarded-proto') ??
    new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export function GET(req: NextRequest): NextResponse {
  const url = new URL(req.url);
  const silent = url.searchParams.get('silent') === '1';
  const origin = originFromRequest(req);

  if (!isAuth0Configured()) {
    if (silent) {
      // Silent probes get a tiny HTML doc that postMessages the
      // parent "not available" — the iframe sender swallows it.
      return silentResultHtml({ ok: false, reason: 'unconfigured' });
    }
    return NextResponse.json(
      {
        error:
          'SSO not configured on this environment. Sign in with the staff form, or set AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET.',
      },
      { status: 503 },
    );
  }

  const returnTo = url.searchParams.get('return_to');
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');

  const stateBlob = JSON.stringify({
    state,
    nonce,
    returnTo: returnTo && returnTo.startsWith('/') ? returnTo : null,
    // Phase 5.9: tag the round-trip as a silent probe so the
    // callback renders a postMessage instead of a redirect.
    silent,
  });

  const target = buildAuth0LoginUrl({ state, nonce, silent, origin });
  const res = NextResponse.redirect(target, { status: 302 });
  res.cookies.set({
    name: STATE_COOKIE,
    value: Buffer.from(stateBlob, 'utf8').toString('base64url'),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SEC,
  });
  return res;
}

/**
 * Render the tiny HTML that a silent probe iframe consumes. Posts
 * a message back to the parent page; the parent decides whether
 * to navigate (on ok) or drop the iframe (on failure).
 */
function silentResultHtml(args: {
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
