import { cookies } from 'next/headers';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@getyn/db';

import {
  AUTH0_SESSION_COOKIE_NAME,
  revokeAllSessions,
  revokeSession,
  verifyAuth0SessionCookie,
} from '@/server/auth/auth0-session';

import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * Phase 5 M2 — user-sessions router.
 *
 * Reads + revokes for the CURRENT user only. Lives outside
 * tenantProcedure because sessions belong to the user, not a tenant
 * — same user, signed into multiple tenants, has one set of sessions.
 *
 * Staff admin (M7) gets a separate router with read-anyone access.
 *
 * # Revoke semantics
 * Soft-delete via `revokedAt` timestamp. Cookie verification refuses
 * a revoked session on the next request → user is logged out of the
 * affected device. The cookie's still-valid-encryption-wise but our
 * server checks fail closed.
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

export const userSessionsRouter = createTRPCRouter({
  /**
   * List the current user's active + recently-revoked sessions.
   * Sorted by lastSeenAt desc so the current device is on top.
   * Recently-revoked rows are kept in the response (badge=Revoked)
   * for transparency — disappear after 30 days of no activity.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.userSession.findMany({
      where: {
        userId,
        OR: [
          { revokedAt: null },
          { revokedAt: { gte: thirtyDaysAgo } },
        ],
      },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        provider: true,
        deviceLabel: true,
        ipAddress: true,
        userAgent: true,
        issuedAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    // Mark which row is THIS session so the UI can show "current device"
    // and disable the revoke button on it.
    const currentSessionId = await resolveCurrentSessionId();

    return rows.map((r) => ({
      ...r,
      isCurrent: r.id === currentSessionId,
    }));
  }),

  /**
   * Revoke a specific session. Refuses to revoke the CURRENT session
   * (use the sign-out button for that — clearing the cookie is the
   * right UX).
   */
  revoke: protectedProcedure
    .input(idSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const currentSessionId = await resolveCurrentSessionId();
      if (currentSessionId === input.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Use the sign-out button for the current device. This action is for revoking remote devices.',
        });
      }
      const target = await prisma.userSession.findFirst({
        where: { id: input.id, userId },
        select: { id: true },
      });
      if (!target) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found.',
        });
      }
      await revokeSession({ sessionId: input.id, userId });
      return { ok: true as const };
    }),

  /**
   * Sign out everywhere. Revokes every non-revoked session except
   * the current one — current stays alive so the user can keep
   * using the app on this device without re-authenticating.
   */
  revokeAllOthers: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const currentSessionId = await resolveCurrentSessionId();
    const result = await revokeAllSessions({
      userId,
      exceptSessionId: currentSessionId ?? undefined,
    });
    return result;
  }),
});

/**
 * Resolve the session id for the active request. Reads the cookie
 * via Next's `cookies()` helper (request-scoped on the server) and
 * re-verifies it through the same path as getCurrentUser. Returns
 * null when there's no Auth0 cookie (e.g. user is on the Supabase
 * staff-fallback path — they have no UserSession row in M2; M2.5
 * can add Supabase-side session tracking if it ever matters).
 */
async function resolveCurrentSessionId(): Promise<string | null> {
  const cookieValue = cookies().get(AUTH0_SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return null;
  const session = await verifyAuth0SessionCookie(cookieValue);
  return session?.sessionId ?? null;
}
