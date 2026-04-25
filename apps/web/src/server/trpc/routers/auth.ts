import { prisma } from '@getyn/db';

import { createTRPCRouter, protectedProcedure, publicProcedure } from '../trpc';

export const authRouter = createTRPCRouter({
  /**
   * Return the caller's user + memberships, or `null` when unauthenticated.
   * Safe for unauthenticated callers — used by the workspace switcher and
   * the root redirect logic.
   */
  session: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    const memberships = await prisma.membership.findMany({
      where: { userId: ctx.user.id },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    return { user: ctx.user, memberships };
  }),

  /**
   * Sign the user out of Supabase. The server client flushes the session
   * cookies back to the response; the client wrapper should also clear its
   * TanStack Query cache afterwards.
   */
  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.supabase.auth.signOut();
    return { ok: true as const };
  }),
});
