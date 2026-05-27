/**
 * Phase 5 M7 — staff session resolver.
 *
 * # The authoritative gate is StaffUser membership.
 * Whether a user has staff access is determined by a row in
 * `StaffUser` keyed on email — not which cookie they're carrying.
 * That keeps the access model auditable and revocable: deleting a
 * StaffUser row immediately locks the holder out of /admin on their
 * next request, even if their session cookie is still valid for
 * the customer surface.
 *
 * # Session source priority
 *   1. The dedicated `getyn_staff_session` cookie (issued by the
 *      M7.5 flow; reserved name so we can switch over without
 *      breaking the resolver).
 *   2. The regular `getyn_sso_session` cookie (Auth0 path).
 *   3. The Supabase session (Phase 1 password / Google OAuth path).
 *
 * Any of the three yields a User; we then look that user's email up
 * in StaffUser. Match → staff context. No match → null (and the
 * layout 404s, so unauthenticated probes never learn the surface
 * exists).
 *
 * # Why we accept the regular session
 * Originally the design was strict: separate cookie scoped to /admin.
 * In practice that means staff sign in twice (once as themselves,
 * once into admin). Pragmatic compromise: same cookie, dual purpose.
 * The StaffUser table is the actual gate; cookie is just identity.
 * If we later want a higher bar for /admin (e.g. step-up auth), the
 * staff-cookie slot is reserved and the migration is a tightening,
 * not a rewrite.
 */
import { cookies } from 'next/headers';

import { prisma, type StaffRole } from '@getyn/db';

import {
  AUTH0_SESSION_COOKIE_NAME,
  verifyAuth0SessionCookie,
} from '@/server/auth/auth0-session';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';

const STAFF_COOKIE_NAME = 'getyn_staff_session';

export interface StaffContext {
  staffUserId: string;
  staffEmail: string;
  role: StaffRole;
  /**
   * UserSession.id backing this staff session — used for audit.
   * Null when the session is a Supabase fallback (no UserSession
   * row backs that path).
   */
  sessionId: string | null;
}

/**
 * Resolve the current staff session, or null. The lookup chain
 * lets us accept any of the three session paths; the final check
 * is always StaffUser membership.
 */
export async function resolveStaffSession(): Promise<StaffContext | null> {
  // Build a list of (userId, sessionId) candidates by priority.
  const candidates = await collectSessionCandidates();
  if (candidates.length === 0) return null;

  // Resolve each candidate's email and check StaffUser. Stop on
  // the first match.
  for (const c of candidates) {
    const user = await prisma.user.findUnique({
      where: { id: c.userId },
      select: { email: true },
    });
    if (!user) continue;

    const staff = await prisma.staffUser.findUnique({
      where: { email: user.email },
    });
    if (!staff) continue;

    return {
      staffUserId: staff.id,
      staffEmail: staff.email,
      role: staff.role,
      sessionId: c.sessionId,
    };
  }
  return null;
}

interface SessionCandidate {
  userId: string;
  sessionId: string | null;
}

async function collectSessionCandidates(): Promise<SessionCandidate[]> {
  const out: SessionCandidate[] = [];
  const jar = cookies();

  // 1) Dedicated staff cookie (reserved name; nothing issues it
  //    yet in M7, but the resolver is forward-compatible).
  const staffCookie = jar.get(STAFF_COOKIE_NAME)?.value;
  if (staffCookie) {
    const session = await verifyAuth0SessionCookie(staffCookie);
    if (session) {
      out.push({ userId: session.userId, sessionId: session.sessionId });
    }
  }

  // 2) Regular Auth0 session cookie.
  const ssoCookie = jar.get(AUTH0_SESSION_COOKIE_NAME)?.value;
  if (ssoCookie) {
    const session = await verifyAuth0SessionCookie(ssoCookie);
    if (session) {
      out.push({ userId: session.userId, sessionId: session.sessionId });
    }
  }

  // 3) Supabase session (Phase 1 password / Google OAuth). The
  //    cookie name is Supabase-internal; we let their SDK read it
  //    via the server client.
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser();
    if (supabaseUser) {
      const u = await prisma.user.findUnique({
        where: { supabaseUserId: supabaseUser.id },
        select: { id: true },
      });
      if (u) out.push({ userId: u.id, sessionId: null });
    }
  } catch {
    // Supabase throws when no session exists — ignore.
  }

  return out;
}

export const STAFF_SESSION_COOKIE_NAME = STAFF_COOKIE_NAME;
