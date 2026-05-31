import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  PlanMetric,
  PlanUpgradeRequestStatus,
  Role,
  prisma,
} from '@getyn/db';

import { getAllCurrentUsage } from '@/server/billing/measure-usage';
import { resolveTenantLimits } from '@/server/billing/resolve-limits';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 5.5 M5 — tenant-side subscription view + upgrade requests.
 *
 * The `get` query returns everything the subscription page needs:
 *   - current plan + status (or null when no subscription)
 *   - resolved per-metric limits (overrides applied)
 *   - current-period usage
 *   - eligible upgrade target plans (more expensive than current)
 *   - whether upgrade requests are accepted globally
 *   - pending request, if any
 *
 * Membership-only — every member sees these numbers (transparency
 * helps with internal upgrade conversations). Only OWNER/ADMIN can
 * submit a request.
 */

const requestUpgradeSchema = z.object({
  targetPlanId: z.string().min(1).max(64),
  reason: z.string().trim().max(2_000).optional(),
});

export const subscriptionRouter = createTRPCRouter({
  /**
   * Subscription dashboard payload. One query → no waterfall.
   */
  get: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;

    const [subscription, limits, usage, plans, settings, pending] =
      await Promise.all([
        prisma.subscription.findUnique({
          where: { tenantId },
          include: {
            plan: { include: { features: true } },
          },
        }),
        resolveTenantLimits(tenantId),
        getAllCurrentUsage(tenantId),
        prisma.plan.findMany({
          where: { isArchived: false },
          include: { features: { orderBy: { metric: 'asc' } } },
          orderBy: [
            { priceMonthlyCents: 'asc' },
            { name: 'asc' },
          ],
        }),
        prisma.appSettings.findUnique({ where: { id: 'singleton' } }),
        prisma.planUpgradeRequest.findFirst({
          where: { tenantId, status: PlanUpgradeRequestStatus.PENDING },
          include: {
            requestedPlan: { select: { id: true, slug: true, name: true } },
            currentPlan: { select: { id: true, slug: true, name: true } },
            requestedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    const currentPlanId = subscription?.planId ?? null;
    const currentPriceCents = subscription?.plan.priceMonthlyCents ?? null;
    // Upgrade target = any non-current plan priced strictly higher
    // than current (null prices fall to the end and are also offered
    // when no current price exists).
    const upgradeTargets = plans.filter((p) => {
      if (p.id === currentPlanId) return false;
      if (currentPriceCents === null) return true;
      if (p.priceMonthlyCents === null) return false;
      return p.priceMonthlyCents > currentPriceCents;
    });

    return {
      tenantId,
      subscription: subscription
        ? {
            id: subscription.id,
            planId: subscription.planId,
            planName: subscription.plan.name,
            planSlug: subscription.plan.slug,
            description: subscription.plan.description,
            priceMonthlyCents: subscription.plan.priceMonthlyCents,
            priceYearlyCents: subscription.plan.priceYearlyCents,
            currency: subscription.plan.currency,
            status: subscription.status,
            assignedAt: subscription.assignedAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAt: subscription.cancelAt,
          }
        : null,
      limits,
      usage,
      allPlans: plans.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        currency: p.currency,
        isCurrent: p.id === currentPlanId,
        features: p.features.map((f) => ({
          metric: f.metric,
          included: f.included,
        })),
      })),
      upgradeTargetIds: upgradeTargets.map((p) => p.id),
      allowUpgradeRequests: settings?.allowUpgradeRequests ?? true,
      pendingRequest: pending
        ? {
            id: pending.id,
            requestedPlan: pending.requestedPlan,
            currentPlan: pending.currentPlan,
            requestedBy: pending.requestedBy,
            reason: pending.reason,
            createdAt: pending.createdAt,
          }
        : null,
    };
  }),

  /**
   * Submit an upgrade request. OWNER/ADMIN only. Server enforces:
   *   - global allowUpgradeRequests flag
   *   - no existing PENDING request (one in-flight at a time)
   *   - target plan exists + is not archived
   *   - target is not the current plan
   */
  requestUpgrade: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(requestUpgradeSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      const settings = await prisma.appSettings.findUnique({
        where: { id: 'singleton' },
      });
      if (!settings?.allowUpgradeRequests) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Upgrade requests are currently disabled.',
        });
      }

      const [target, subscription, existingPending] = await Promise.all([
        prisma.plan.findUnique({
          where: { id: input.targetPlanId },
          select: { id: true, isArchived: true },
        }),
        prisma.subscription.findUnique({
          where: { tenantId },
          select: { planId: true },
        }),
        prisma.planUpgradeRequest.findFirst({
          where: { tenantId, status: PlanUpgradeRequestStatus.PENDING },
          select: { id: true },
        }),
      ]);

      if (!target || target.isArchived) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Target plan unavailable.',
        });
      }
      if (subscription?.planId === target.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You are already on that plan.',
        });
      }
      if (existingPending) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'A request is already pending. Withdraw it before submitting another.',
        });
      }

      return prisma.planUpgradeRequest.create({
        data: {
          tenantId,
          requestedByUserId: userId,
          currentPlanId: subscription?.planId ?? null,
          requestedPlanId: target.id,
          reason: input.reason ?? null,
        },
      });
    }),

  /**
   * Withdraw the current pending request. Anyone in the workspace
   * can withdraw, mirroring how anyone can see the request.
   */
  withdrawUpgrade: tenantProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await prisma.planUpgradeRequest.findUnique({
        where: { id: input.id },
      });
      if (!row || row.tenantId !== tenantId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Request not found.',
        });
      }
      if (row.status !== PlanUpgradeRequestStatus.PENDING) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot withdraw a request that is ${row.status}.`,
        });
      }
      return prisma.planUpgradeRequest.update({
        where: { id: row.id },
        data: { status: PlanUpgradeRequestStatus.WITHDRAWN },
      });
    }),
});

void PlanMetric; // re-exported via tRPC inference
