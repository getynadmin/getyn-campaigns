import { TRPCError } from '@trpc/server';
import { prisma, Role } from '@getyn/db';
import { z } from 'zod';

import { TRIAL_DAYS, ONE_DAY_MS } from '@/lib/constants';
import { makeUniqueSlug } from '@/server/slug';
import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * Onboarding = "I have a Supabase session but no DB User row yet."
 *
 * This happens when someone signs in via Google OAuth without having
 * gone through `/signup` first: the callback creates a Supabase auth
 * user, but we still need to provision a `User`, `Tenant`, and OWNER
 * `Membership` before the app is usable.
 *
 * We cannot use `protectedProcedure` here because that requires the
 * DB User row to already exist. Instead we pull the authenticated
 * Supabase user straight from the request-scoped client.
 */
export const onboardingRouter = createTRPCRouter({
  /** Returns which step the caller needs next: sign in, provision, or ready. */
  status: publicProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase.auth.getUser();
    if (!data.user) return { step: 'unauthenticated' as const };
    if (ctx.user) return { step: 'ready' as const, email: ctx.user.email };
    return {
      step: 'needs_workspace' as const,
      email: data.user.email ?? '',
      name: (data.user.user_metadata?.name as string | undefined) ?? '',
    };
  }),

  /**
   * Create the missing User + Tenant + OWNER Membership for an OAuth
   * user who signed in but doesn't have a DB footprint yet.
   */
  completeOAuthSignup: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        workspaceName: z.string().min(2).max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data } = await ctx.supabase.auth.getUser();
      if (!data.user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be signed in to complete signup.',
        });
      }

      // If a DB user already exists (e.g. double-submit), return their
      // first workspace instead of erroring. Idempotency wins.
      const existing = await prisma.user.findUnique({
        where: { supabaseUserId: data.user.id },
        include: {
          memberships: {
            include: { tenant: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      });
      if (existing) {
        const first = existing.memberships[0]?.tenant;
        if (first) return { tenantSlug: first.slug };
      }

      const email = data.user.email;
      if (!email) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Your account has no email address.',
        });
      }

      const slug = await makeUniqueSlug(input.workspaceName);
      const result = await prisma.$transaction(async (tx) => {
        const user =
          existing ??
          (await tx.user.create({
            data: {
              email,
              name: input.name,
              supabaseUserId: data.user!.id,
            },
          }));
        const tenant = await tx.tenant.create({
          data: {
            name: input.workspaceName,
            slug,
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * ONE_DAY_MS),
          },
        });
        await tx.membership.create({
          data: { userId: user.id, tenantId: tenant.id, role: Role.OWNER },
        });
        return tenant;
      });
      return { tenantSlug: result.slug };
    }),
});
