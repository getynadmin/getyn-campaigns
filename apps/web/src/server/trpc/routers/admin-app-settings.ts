import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5.5 M2 — admin.appSettings.*
 *
 * AppSettings is a singleton row (id='singleton', CHECK enforced).
 * The row is seeded by migration 0007 so `get` always returns it.
 *
 * Read: any staff. Update: SUPPORT_ADMIN. Every write goes through
 * withAdminContext so a StaffAuditLog row lands atomically — flipping
 * `defaultPlanAutoAssign` affects every future tenant signup.
 */

const SINGLETON_ID = 'singleton';

const updateSchema = z.object({
  defaultPlanId: z.string().min(1).max(64).nullable(),
  defaultPlanAutoAssign: z.boolean(),
  allowUpgradeRequests: z.boolean(),
});

export const adminAppSettingsRouter = createAdminRouter({
  get: staffProcedure.query(async () => {
    const row = await prisma.appSettings.findUnique({
      where: { id: SINGLETON_ID },
      include: {
        defaultPlan: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!row) {
      // The migration seeds this — if it's missing the DB is in a
      // broken state. Surfacing it as 500 is correct.
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'AppSettings singleton missing — run migrations.',
      });
    }
    return row;
  }),

  update: supportAdminProcedure
    .input(updateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const before = await tx.appSettings.findUnique({
          where: { id: SINGLETON_ID },
        });
        if (!before) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'AppSettings singleton missing.',
          });
        }
        if (input.defaultPlanId) {
          const plan = await tx.plan.findUnique({
            where: { id: input.defaultPlanId },
            select: { id: true, isArchived: true },
          });
          if (!plan) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Default plan not found.',
            });
          }
          if (plan.isArchived) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Archived plans cannot be used as the default.',
            });
          }
        }
        if (input.defaultPlanAutoAssign && !input.defaultPlanId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Auto-assign requires a default plan. Pick one before enabling.',
          });
        }
        const updated = await tx.appSettings.update({
          where: { id: SINGLETON_ID },
          data: {
            defaultPlanId: input.defaultPlanId,
            defaultPlanAutoAssign: input.defaultPlanAutoAssign,
            allowUpgradeRequests: input.allowUpgradeRequests,
            updatedByStaffUserId: ctx.staff.staffUserId,
          },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.appSettings.updated',
            beforeSnapshot: before,
            afterSnapshot: updated,
          },
        };
      });
    }),
});
