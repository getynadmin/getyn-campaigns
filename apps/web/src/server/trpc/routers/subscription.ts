import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  CheckoutOrderStatus,
  PlanMetric,
  PlanUpgradeRequestStatus,
  Role,
  prisma,
} from '@getyn/db';

import { appBaseUrl } from '@/server/auth/auth0';
import { getAllCurrentUsage } from '@/server/billing/measure-usage';
import { resolveTenantLimits } from '@/server/billing/resolve-limits';
import {
  createXpaySubscription,
  getXpayCredentials,
} from '@/server/integrations/xpay';

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
   * Compact usage + limit payload — for tile-style displays (e.g. the
   * EmailQuotaTile in the topbar). Returns one row per PlanMetric with
   * the resolved limit and current-period usage. Cheaper than `get`
   * because it skips the plan catalogue + upgrade-target resolution.
   */
  usage: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const [limits, usage] = await Promise.all([
      resolveTenantLimits(tenantId),
      getAllCurrentUsage(tenantId),
    ]);
    return {
      metrics: (Object.keys(limits) as Array<keyof typeof limits>).map((m) => ({
        metric: m,
        limit: limits[m],
        current: usage[m] ?? 0,
      })),
    };
  }),

  /**
   * Subscription dashboard payload. One query → no waterfall.
   */
  get: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;

    const [subscription, limits, usage, plans, settings, pending, tenant] =
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
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { trialEndsAt: true, billingStatus: true },
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

    const now = Date.now();
    const trialEndsAt = tenant?.trialEndsAt ?? null;
    const trialMsLeft = trialEndsAt
      ? Math.max(0, trialEndsAt.getTime() - now)
      : 0;
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil(trialMsLeft / 86_400_000))
      : 0;
    const isOnTrial =
      subscription?.status === 'TRIALING' ||
      (tenant?.billingStatus === 'TRIALING' && trialDaysLeft > 0);

    return {
      tenantId,
      trial: {
        isOnTrial,
        trialEndsAt,
        daysLeft: trialDaysLeft,
      },
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
            extraAiCreditsPricePer100:
              subscription.plan.extraAiCreditsPricePer100,
            extraWhatsappPricePer100:
              subscription.plan.extraWhatsappPricePer100,
            extraSmsPricePer100: subscription.plan.extraSmsPricePer100,
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
        extraAiCreditsPricePer100: p.extraAiCreditsPricePer100,
        extraWhatsappPricePer100: p.extraWhatsappPricePer100,
        extraSmsPricePer100: p.extraSmsPricePer100,
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
   * Start a tenant-initiated plan upgrade. The caller picks how many
   * extra 100-unit bundles they want of AI credits / WA / SMS; the
   * server reruns the price math against Plan.extra*PricePer100 and
   * either:
   *   - previewMode: no xPay keys configured → applies overrides as
   *     TenantLimitOverride rows immediately + returns applied:true
   *     (the fast path for dev + ops).
   *   - real mode: creates a CheckoutOrder + xPay subscription and
   *     returns the hosted fwdUrl for the client to redirect to.
   *     Overrides land on the return webhook (see TODO below).
   *
   * On success, the limit overrides are applied with reason
   * 'self_upgrade_<timestamp>' so they are visible in admin audit.
   *
   * NOTE: wiring the real-mode success path to the webhook/return
   * endpoint for permanent overrides is a follow-up; preview mode
   * (no xPay) already lands them. See project_getyn_campaigns.md.
   */
  startUpgrade: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        extraAiBundles: z.number().int().min(0).max(50).default(0),
        extraWhatsappBundles: z.number().int().min(0).max(100).default(0),
        extraSmsBundles: z.number().int().min(0).max(100).default(0),
        billingCycle: z.enum(['monthly', 'annual']).default('monthly'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const sub = await prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      if (!sub) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No active subscription to upgrade.',
        });
      }
      const plan = sub.plan;
      const extras =
        input.extraAiBundles * plan.extraAiCreditsPricePer100 +
        input.extraWhatsappBundles * plan.extraWhatsappPricePer100 +
        input.extraSmsBundles * plan.extraSmsPricePer100;
      const baseMonthly = plan.priceMonthlyCents ?? 0;
      const monthly = baseMonthly + extras;
      // Simple yearly: 12× monthly (plan-level annual discount can be
      // layered later via plan.metadata.pricing).
      const yearly = monthly * 12;
      const totalCents =
        input.billingCycle === 'monthly' ? monthly : yearly;

      if (extras === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Nothing to upgrade — add at least one bundle.',
        });
      }

      // Helper: apply the extras as TenantLimitOverride rows for this
      // period. Each override stacks on top of the plan limit.
      const applyOverrides = async (): Promise<void> => {
        const reason = `self_upgrade_${Date.now()}`;
        const currentLimits = await resolveTenantLimits(tenantId);
        const extrasList: Array<{ metric: PlanMetric; add: number }> = [];
        if (input.extraAiBundles > 0) {
          extrasList.push({
            metric: PlanMetric.AI_CREDITS_PER_MONTH,
            add: input.extraAiBundles * 100,
          });
        }
        if (input.extraWhatsappBundles > 0) {
          extrasList.push({
            metric: PlanMetric.WA_MESSAGES_PER_MONTH,
            add: input.extraWhatsappBundles * 100,
          });
        }
        if (input.extraSmsBundles > 0) {
          extrasList.push({
            metric: PlanMetric.SMS_SEGMENTS_PER_MONTH,
            add: input.extraSmsBundles * 100,
          });
        }
        for (const e of extrasList) {
          const base = currentLimits[e.metric];
          // Unlimited stays unlimited; otherwise write a total cap.
          const included = base === -1 ? -1 : base + e.add;
          await prisma.tenantLimitOverride.create({
            data: {
              tenantId,
              metric: e.metric,
              included,
              reason,
            },
          });
        }
      };

      // Attempt xPay checkout.
      const creds = await getXpayCredentials();
      if (!creds.privateKey || !creds.publicKey) {
        // Preview mode — apply overrides immediately. Useful in dev +
        // when xPay is not yet configured; a staff user can revert via
        // the admin override controls.
        await applyOverrides();
        return {
          ok: true as const,
          previewMode: true as const,
          applied: true as const,
          totalCents,
          fwdUrl: null,
          message:
            'XPay is not configured — the upgrade was applied immediately in preview mode.',
        };
      }

      const merchantReference = `up_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const order = await prisma.checkoutOrder.create({
        data: {
          merchantReference,
          status: CheckoutOrderStatus.DRAFT,
          planId: plan.id,
          planSlug: plan.slug,
          planName: `${plan.name} + extras`,
          volumeMessages: 0,
          billingCycle: input.billingCycle,
          amountCents: totalCents,
          currency: plan.currency,
          customerEmail: ctx.user.email,
          customerFirstName: ctx.user.name ?? ctx.user.email.split('@')[0] ?? '',
          customerLastName: null,
          tenantId,
          userId: ctx.user.id,
          extraAiBundles: input.extraAiBundles,
          extraWhatsappBundles: input.extraWhatsappBundles,
          extraSmsBundles: input.extraSmsBundles,
          upgradeMethod: 'xpay_upgrade',
        },
      });
      const callbackUrl = new URL(
        `/api/payments/xpay/return?ref=${encodeURIComponent(order.merchantReference)}`,
        creds.callbackBaseUrl ?? appBaseUrl(),
      ).toString();
      const created = await createXpaySubscription({
        planName: `${plan.name} + extras`,
        amountCents: totalCents,
        currency: plan.currency,
        billingCycle: input.billingCycle,
        merchantReference: order.merchantReference,
        callbackUrl,
        customer: {
          email: ctx.user.email,
          name: ctx.user.name ?? ctx.user.email,
          // Placeholder — upgrade flow doesn't collect phone yet; xPay
          // will reject if required. Operator-facing fallback.
          contactNumber: '+10000000000',
        },
        metadata: {
          planSlug: plan.slug,
          method: 'xpay_upgrade',
          extraAiBundles: String(input.extraAiBundles),
          extraWhatsappBundles: String(input.extraWhatsappBundles),
          extraSmsBundles: String(input.extraSmsBundles),
          tenantId,
        },
      });
      if (!created.ok || !created.fwdUrl) {
        await prisma.checkoutOrder.update({
          where: { id: order.id },
          data: {
            status: CheckoutOrderStatus.FAILED,
            failedAt: new Date(),
            failureReason:
              created.message ?? 'XPay did not return a checkout URL.',
          },
        });
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: created.message ?? 'Payment gateway rejected the request.',
        });
      }
      await prisma.checkoutOrder.update({
        where: { id: order.id },
        data: {
          status: CheckoutOrderStatus.PENDING,
          xpaySubscriptionId: created.subscriptionId ?? null,
          xpayFwdUrl: created.fwdUrl,
        },
      });
      return {
        ok: true as const,
        previewMode: false as const,
        applied: false as const,
        totalCents,
        fwdUrl: created.fwdUrl,
        merchantReference: order.merchantReference,
      };
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
