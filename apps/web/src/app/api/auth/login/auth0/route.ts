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

export function GET(req: NextRequest): NextResponse {
  if (!isAuth0Configured()) {
    return NextResponse.json(
      {
        error:
          'SSO not configured on this environment. Sign in with the staff form, or set AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET.',
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const returnTo = url.searchParams.get('return_to');
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');

  const stateBlob = JSON.stringify({
    state,
    nonce,
    returnTo: returnTo && returnTo.startsWith('/') ? returnTo : null,
  });

  const target = buildAuth0LoginUrl({ state, nonce });
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
