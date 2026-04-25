import { TRPCError } from '@trpc/server';
import { prisma, Role } from '@getyn/db';
import { z } from 'zod';

import { TRIAL_DAYS, ONE_DAY_MS } from '@/lib/constants';
import { getSupabaseAdmin } from '@/server/auth/supabase-admin';
import { makeUniqueSlug } from '@/server/slug';
import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * Signup is its own router so the flow (Supabase auth + DB provisioning +
 * session cookie handshake) stays readable.
 *
 * Flow:
 *   1. Call `supabase.auth.signUp` via the request-scoped server client so
 *      that Set-Cookie lands on the response and the caller is logged in.
 *   2. Provision `User`, `Tenant`, `Membership` in one transaction.
 *   3. Return the tenant slug so the client can `router.push` to
 *      `/t/[slug]/dashboard`.
 *
 * Assumptions:
 *   - Supabase email confirmation is disabled (or auto-confirmed) in dev —
 *     otherwise `signUp` returns a user without a session and the UI has
 *     to show "check your inbox" first. We deliberately fail fast in that
 *     case rather than silently skip DB provisioning.
 */
export const signupRouter = createTRPCRouter({
  create: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8).max(72),
        name: z.string().min(1).max(80),
        workspaceName: z.string().min(2).max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check the DB first so we can produce a friendly error before touching
      // Supabase (signUp on an existing email returns an ambiguous shape).
      const existing = await prisma.user.findUnique({
        where: { email: input.email },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An account with that email already exists.',
        });
      }

      const { data: signUpData, error } = await ctx.supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { name: input.name } },
      });

      if (error || !signUpData.user) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error?.message ?? 'Signup failed.',
        });
      }

      if (!signUpData.session) {
        // Email confirmation is enabled upstream; we cannot log the user in.
        // Roll back by deleting the Supabase auth user so they can retry.
        await getSupabaseAdmin().auth.admin.deleteUser(signUpData.user.id);
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Email confirmation is required. Disable it in Supabase or use an invite flow.',
        });
      }

      const slug = await makeUniqueSlug(input.workspaceName);

      try {
        const result = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.email,
              name: input.name,
              supabaseUserId: signUpData.user!.id,
            },
          });
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
          return { user, tenant };
        });
        return { tenantSlug: result.tenant.slug };
      } catch (err) {
        // Best-effort rollback of the Supabase user so retries succeed.
        await getSupabaseAdmin().auth.admin.deleteUser(signUpData.user.id).catch(() => null);
        throw err;
      }
    }),
});
