/**
 * Phase 5 M7 — staff session resolver.
 *
 * Separate session lookup from the tenant-user side. Reasons:
 *   1. Privilege escalation prevention — a regular tenant user
 *      can't accidentally land in /admin/* by reusing the tenant
 *      cookie. Staff have a dedicated session cookie name.
 *   2. Distinct cookie scope — staff cookie has `Path=/admin` so
 *      it never even leaks into tenant requests.
 *   3. Distinct lifecycle — staff sessions can be invalidated
 *      independently of tenant sessions.
 *
 * Auth flow:
 *   1. Staff email/password (Phase 1 password under the hood) OR
 *      Auth0 with the `is_getyn_staff: true` claim → /admin/login
 *      callback issues the staff cookie.
 *   2. The cookie carries a sessionToken pointing at a row in
 *      `UserSession` with provider=AUTH0 and the user's
 *      authProvider=AUTH0 + a row in `StaffUser` keyed by email.
 *   3. resolveStaffSession() reads + verifies. Returns null on
 *      any mismatch — admin pages render 404 to avoid leaking
 *      the surface's existence.
 *
 * # Why we reuse UserSession rather than a separate StaffSession
 * Identical revoke/list semantics, and a staff user IS still a
 * User row (with role flowing from StaffUser, not Membership).
 * Adding a parallel table just duplicates plumbing.
 */
import { cookies } from 'next/headers';

import { prisma, type StaffRole } from '@getyn/db';

import { verifyAuth0SessionCookie } from '@/server/auth/auth0-session';

const STAFF_COOKIE_NAME = 'getyn_staff_session';

export interface StaffContext {
  staffUserId: string;
  staffEmail: string;
  role: StaffRole;
  /** UserSession.id backing this staff session — used for audit. */
  sessionId: string;
}

/**
 * Resolve the current staff session, or null. Lookup chain:
 *   1. Read the staff cookie (Path=/admin).
 *   2. Verify the cookie payload + UserSession row (same primitive
 *      as tenant-side; only the cookie name differs).
 *   3. Resolve User → email → StaffUser row.
 *   4. Return { staffUserId, email, role, sessionId } or null.
 */
export async function resolveStaffSession(): Promise<StaffContext | null> {
  const value = cookies().get(STAFF_COOKIE_NAME)?.value;
  if (!value) return null;

  const session = await verifyAuth0SessionCookie(value);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true },
  });
  if (!user) return null;

  const staff = await prisma.staffUser.findUnique({
    where: { email: user.email },
  });
  if (!staff) return null;

  return {
    staffUserId: staff.id,
    staffEmail: staff.email,
    role: staff.role,
    sessionId: session.sessionId,
  };
}

export const STAFF_SESSION_COOKIE_NAME = STAFF_COOKIE_NAME;
