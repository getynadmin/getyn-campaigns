import { TRPCError } from '@trpc/server';
import { Prisma } from '@getyn/db';
import { prisma, Role } from '@getyn/db';
import { tenantSlugSchema } from '@getyn/types';
import { z } from 'zod';

import { TRIAL_DAYS, ONE_DAY_MS } from '@/lib/constants';
import { makeUniqueSlug } from '@/server/slug';
import {
  createTRPCRouter,
  enforceRole,
  protectedProcedure,
  tenantProcedure,
} from '../trpc';

export const tenantRouter = createTRPCRouter({
  /** Full tenant row for the currently-scoped workspace. */
  current: tenantProcedure.query(({ ctx }) => ctx.tenantContext.tenant),

  /** All workspaces the current user belongs to (for the switcher). */
  listMine: protectedProcedure.query(({ ctx }) =>
    prisma.tenant.findMany({
      where: { memberships: { some: { userId: ctx.user.id } } },
      orderBy: { createdAt: 'asc' },
    }),
  ),

  /**
   * Provision a new workspace for the current user.
   * The user becomes its OWNER in the same transaction.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const slug = await makeUniqueSlug(input.name);
      return prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: input.name,
            slug,
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * ONE_DAY_MS),
          },
        });
        await tx.membership.create({
          data: { userId: ctx.user.id, tenantId: tenant.id, role: Role.OWNER },
        });
        return tenant;
      });
    }),

  /**
   * Update workspace name and/or slug. OWNER or ADMIN only.
   * Slug changes are validated against the global unique index — a collision
   * surfaces as a user-visible CONFLICT error.
   */
  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        name: z.string().min(2).max(60).optional(),
        slug: tenantSlugSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prisma.tenant.update({
          where: { id: ctx.tenantContext.tenant.id },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.slug ? { slug: input.slug } : {}),
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'That slug is already taken.',
          });
        }
        throw err;
      }
    }),
});
