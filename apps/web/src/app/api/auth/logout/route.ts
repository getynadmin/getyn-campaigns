import { NextResponse, type NextRequest } from 'next/server';

import {
  appBaseUrl,
  buildAuth0LogoutUrl,
  isAuth0Configured,
} from '@/server/auth/auth0';
import { AUTH0_SESSION_COOKIE_NAME } from '@/server/auth/auth0-session';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * Phase 5 M1 — federated sign-out.
 *
 * Clears both auth surfaces:
 *   1. Auth0 session cookie (Campaigns-issued)
 *   2. Supabase session (existing Phase 1 cookie set)
 *
 * Then redirects to Auth0's /v2/logout, which federates upstream to
 * G-Suite. Single sign-out across all Getyn apps.
 *
 * Supports POST (preferred — CSRF-resistant via same-origin form) and
 * GET (for the sidebar menu link). Both behave identically.
 *
 * Phase 5.7 fix: the return-to origin is derived from the incoming
 * request first, with appBaseUrl() as fallback. Vercel routes the
 * custom domain (campaigns.getyn.com) through to this handler with
 * the right Host header, so we always send the user back to the
 * same domain they came from — even when NEXT_PUBLIC_APP_URL isn't
 * set as a runtime env var.
 */
function originFromRequest(req: NextRequest): string {
  // x-forwarded-* headers are set by Vercel's edge. Prefer them
  // over the URL the handler was invoked with (which on Vercel can
  // be the internal /api hostname).
  const proto =
    req.headers.get('x-forwarded-proto') ??
    new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) return `${proto}://${host}`;
  // Last resort: fall back to env-driven base URL.
  return appBaseUrl();
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // 1) Sign out of Supabase (no-op if no session).
  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Supabase sometimes throws when there's no session — ignore.
  }

  // 2) Build the redirect target. Origin comes from the incoming
  //    request so the user lands back on whatever domain they were
  //    using (campaigns.getyn.com vs the old vercel.app alias vs
  //    localhost in dev). If Auth0 is configured, federate out so
  //    the IdP session also drops.
  const origin = originFromRequest(req);
  const returnTo = `${origin}/login?logged_out=1`;
  const target = isAuth0Configured()
    ? buildAuth0LogoutUrl({ returnTo })
    : returnTo;

  const res = NextResponse.redirect(target, { status: 302 });
  // 3) Clear our session cookie.
  res.cookies.delete(AUTH0_SESSION_COOKIE_NAME);
  // Defence in depth — also nuke the SSO state cookie if any.
  res.cookies.delete('getyn_sso_state');
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
