/* eslint-disable no-console */
import { cookies } from 'next/headers';

import { prisma, type User } from '@getyn/db';

import { createSupabaseServerClient } from './supabase-server';
import { verifyAuth0SessionCookie } from './auth0-session';

/**
 * Resolve the current user for the active request — dual-provider aware
 * (Phase 5 M1). Tries the Auth0 session cookie first (issued by
 * /api/auth/callback/auth0), then falls back to Supabase. Either is
 * sufficient. Returns `null` when neither path lands a user row.
 *
 * # Why Auth0 first
 * SSO is the future-default path; Supabase email/password is staff-
 * fallback in prod (`STAFF_PASSWORD_AUTH_ENABLED=false`) and dev-only
 * otherwise. Probing the SSO cookie first means we don't pay the
 * Supabase-server round trip on every authenticated SSO request.
 *
 * # Stale-user case
 * Either session can point at a `User` row that's since been deleted
 * (tenant purge). We return `null` so middleware redirects to /login,
 * not 500.
 */
export async function getCurrentUser(): Promise<User | null> {
  // 1) Auth0 session cookie (set after provisionFromSso).
  const cookieJar = cookies();
  const sessionCookie = cookieJar.get('getyn_sso_session');
  if (sessionCookie?.value) {
    try {
      const session = await verifyAuth0SessionCookie(sessionCookie.value);
      if (session) {
        const user = await prisma.user.findUnique({
          where: { id: session.userId },
        });
        if (user) return user;
      }
    } catch (err) {
      // Tampered or expired cookie — fall through to Supabase. Log
      // once per invocation; not Sentry-worthy (legitimate logout
      // edge cases trip it).
      console.warn(
        '[session] auth0 cookie verify failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2) Supabase fallback (Phase 1 path).
  const supabase = createSupabaseServerClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();
  if (!supabaseUser) return null;
  return prisma.user.findUnique({
    where: { supabaseUserId: supabaseUser.id },
  });
}
