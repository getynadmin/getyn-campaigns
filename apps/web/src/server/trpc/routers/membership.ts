import { TRPCError } from '@trpc/server';
import { prisma, Role } from '@getyn/db';
import { roleSchema, cuidSchema } from '@getyn/types';
import { z } from 'zod';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

export const membershipRouter = createTRPCRouter({
  /** List every member of the current workspace. Any member can call this. */
  list: tenantProcedure.query(({ ctx }) =>
    prisma.membership.findMany({
      where: { tenantId: ctx.tenantContext.tenant.id },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
  ),

  /** Change a member's role. OWNER or ADMIN only. Cannot demote the last OWNER. */
  updateRole: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        membershipId: cuidSchema,
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await prisma.membership.findUnique({
        where: { id: input.membershipId },
      });
      if (!target || target.tenantId !== ctx.tenantContext.tenant.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found.' });
      }

      // ADMIN callers cannot promote or demote OWNERs.
      if (
        ctx.tenantContext.membership.role !== Role.OWNER &&
        (target.role === Role.OWNER || input.role === Role.OWNER)
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners can change the OWNER role.',
        });
      }

      // Protect the last OWNER invariant.
      if (target.role === Role.OWNER && input.role !== Role.OWNER) {
        const remainingOwners = await prisma.membership.count({
          where: {
            tenantId: ctx.tenantContext.tenant.id,
            role: Role.OWNER,
            id: { not: target.id },
          },
        });
        if (remainingOwners === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A workspace must have at least one owner.',
          });
        }
      }

      return prisma.membership.update({
        where: { id: target.id },
        data: { role: input.role },
      });
    }),

  /** Remove a member. Same owner-protection rules as updateRole. */
  remove: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ membershipId: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const target = await prisma.membership.findUnique({
        where: { id: input.membershipId },
      });
      if (!target || target.tenantId !== ctx.tenantContext.tenant.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found.' });
      }

      if (
        ctx.tenantContext.membership.role !== Role.OWNER &&
        target.role === Role.OWNER
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners can remove an owner.',
        });
      }

      if (target.role === Role.OWNER) {
        const remainingOwners = await prisma.membership.count({
          where: {
            tenantId: ctx.tenantContext.tenant.id,
            role: Role.OWNER,
            id: { not: target.id },
          },
        });
        if (remainingOwners === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A workspace must have at least one owner.',
          });
        }
      }

      await prisma.membership.delete({ where: { id: target.id } });
      return { ok: true as const };
    }),
});
