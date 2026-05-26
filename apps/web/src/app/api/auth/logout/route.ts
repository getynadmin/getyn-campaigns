import { NextResponse, type NextRequest } from 'next/server';

import {
  appBaseUrl,
  buildAuth0LogoutUrl,
  isAuth0Configured,
} from '@/server/auth/auth0';
import { AUTH0_SESSION_COOKIE_NAME } from '@/server/auth/auth0-session';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';

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
 */
async function handle(_req: NextRequest): Promise<NextResponse> {
  // 1) Sign out of Supabase (no-op if no session).
  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Supabase sometimes throws when there's no session — ignore.
  }

  // 2) Build the redirect target. If Auth0 is configured, federate
  //    out so the IdP session also drops. Otherwise just bounce to
  //    the marketing /login page.
  const target = isAuth0Configured()
    ? buildAuth0LogoutUrl({ returnTo: `${appBaseUrl()}/login?logged_out=1` })
    : `${appBaseUrl()}/login?logged_out=1`;

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
