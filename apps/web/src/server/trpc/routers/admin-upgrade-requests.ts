import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  PlanUpgradeRequestStatus,
  SubscriptionStatus,
  prisma,
} from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5.5 M6 — admin.upgradeRequest.*
 *
 * Review queue for tenant-initiated upgrade requests. Approving a
 * request optionally also re-assigns the tenant's Subscription so
 * the change goes live in one click (default), or leaves the
 * subscription untouched if staff wants a follow-up call first.
 *
 * Read: any staff. Approve/reject: SUPPORT_ADMIN.
 */

const listInputSchema = z.object({
  status: z.nativeEnum(PlanUpgradeRequestStatus).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const decisionSchema = z.object({
  id: z.string().min(1).max(64),
  reviewerNote: z.string().trim().max(2_000).optional(),
});

export const adminUpgradeRequestsRouter = createAdminRouter({
  list: staffProcedure
    .input(listInputSchema)
    .query(async ({ input }) => {
      const rows = await prisma.planUpgradeRequest.findMany({
        where: {
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          tenant: { select: { id: true, slug: true, name: true } },
          currentPlan: { select: { id: true, slug: true, name: true } },
          requestedPlan: {
            select: {
              id: true,
              slug: true,
              name: true,
              priceMonthlyCents: true,
              currency: true,
            },
          },
          requestedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: [
          // PENDING first, then by recency.
          { status: 'asc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const next = rows.pop();
        nextCursor = next?.id ?? null;
      }
      return { items: rows, nextCursor };
    }),

  /**
   * Approve a request. If `assignNow` is true (default), the tenant's
   * Subscription is upserted to the requested plan inside the same
   * transaction. Two audit rows land — one for the decision, one
   * for the implicit subscription change — because the subscription
   * assign is an independently meaningful action.
   */
  approve: supportAdminProcedure
    .input(decisionSchema.extend({ assignNow: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const row = await tx.planUpgradeRequest.findUnique({
          where: { id: input.id },
          include: { requestedPlan: { select: { id: true, isArchived: true } } },
        });
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });
        }
        if (row.status !== PlanUpgradeRequestStatus.PENDING) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Request is ${row.status}.`,
          });
        }
        if (row.requestedPlan.isArchived) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Requested plan has been archived. Pick a replacement before approving.',
          });
        }

        const before = row;
        const updated = await tx.planUpgradeRequest.update({
          where: { id: row.id },
          data: {
            status: PlanUpgradeRequestStatus.APPROVED,
            reviewedAt: new Date(),
            reviewedByStaffUserId: ctx.staff.staffUserId,
            reviewerNote: input.reviewerNote ?? null,
          },
        });

        if (input.assignNow) {
          const existing = await tx.subscription.findUnique({
            where: { tenantId: row.tenantId },
          });
          const data = {
            planId: row.requestedPlanId,
            status: SubscriptionStatus.ACTIVE,
            assignedByStaffUserId: ctx.staff.staffUserId,
            assignedAt: new Date(),
            cancelAt: null,
          };
          if (existing) {
            await tx.subscription.update({
              where: { tenantId: row.tenantId },
              data,
            });
          } else {
            await tx.subscription.create({
              data: { tenantId: row.tenantId, ...data },
            });
          }
        }

        return {
          result: updated,
          audit: {
            action: input.assignNow
              ? 'admin.upgrade_request.approved_and_assigned'
              : 'admin.upgrade_request.approved',
            targetTenantId: row.tenantId,
            targetEntityId: row.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
            reason: input.reviewerNote ?? null,
          },
        };
      });
    }),

  reject: supportAdminProcedure
    .input(decisionSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const row = await tx.planUpgradeRequest.findUnique({
          where: { id: input.id },
        });
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });
        }
        if (row.status !== PlanUpgradeRequestStatus.PENDING) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Request is ${row.status}.`,
          });
        }
        const updated = await tx.planUpgradeRequest.update({
          where: { id: row.id },
          data: {
            status: PlanUpgradeRequestStatus.REJECTED,
            reviewedAt: new Date(),
            reviewedByStaffUserId: ctx.staff.staffUserId,
            reviewerNote: input.reviewerNote ?? null,
          },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.upgrade_request.rejected',
            targetTenantId: row.tenantId,
            targetEntityId: row.id,
            beforeSnapshot: row,
            afterSnapshot: updated,
            reason: input.reviewerNote ?? null,
          },
        };
      });
    }),
});
