import { NextResponse } from 'next/server';

import { isAuth0Configured } from '@/server/auth/auth0';

export const dynamic = 'force-dynamic';

/**
 * Phase 5.9 diagnostic — confirms which Auth0 env vars the running
 * deployment sees. Returns booleans only; values are never echoed
 * back so the endpoint is safe to leave reachable. Useful right
 * after toggling env vars in Vercel to verify a redeploy actually
 * picked them up.
 *
 * Remove (or move behind a staff session) once SSO is stable.
 */
export function GET(): NextResponse {
  return NextResponse.json({
    isAuth0Configured: isAuth0Configured(),
    hasDomain: Boolean(process.env.AUTH0_DOMAIN),
    hasClientId: Boolean(process.env.AUTH0_CLIENT_ID),
    hasClientSecret: Boolean(process.env.AUTH0_CLIENT_SECRET),
    hasAudience: Boolean(process.env.AUTH0_AUDIENCE),
    hasLogoutReturnTo: Boolean(process.env.AUTH0_LOGOUT_RETURN_TO),
    // Echo just the domain hostname so you can confirm it points at
    // login.getyn.com (the value can be a host or a full URL with scheme).
    domainHost: process.env.AUTH0_DOMAIN
      ? process.env.AUTH0_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')
      : null,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}
