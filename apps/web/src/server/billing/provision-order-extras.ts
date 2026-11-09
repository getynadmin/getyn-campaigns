import { PlanMetric, prisma } from '@getyn/db';

import { publishNotification } from '../notifications/publish';
import { resolveTenantLimits } from './resolve-limits';

/**
 * Apply the `extra*Bundles` stored on a PAID CheckoutOrder as
 * TenantLimitOverride rows — one per metric with bundles > 0.
 *
 * Idempotent: short-circuits if `extrasAppliedAt` is already set, so
 * both the webhook and the return handler can call this safely.
 * Each bundle = 100 units of that metric, layered on top of the plan
 * base limits. Unlimited plan limits stay unlimited.
 *
 * No-op if the order has no `tenantId` yet (e.g. a first-signup order
 * where the tenant will be created later); the caller that finally
 * links `tenantId` should re-invoke this.
 */
export async function provisionOrderExtras(orderId: string): Promise<{
  applied: boolean;
  reason?: string;
}> {
  const order = await prisma.checkoutOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      tenantId: true,
      extraAiBundles: true,
      extraWhatsappBundles: true,
      extraSmsBundles: true,
      extrasAppliedAt: true,
      upgradeMethod: true,
    },
  });
  if (!order) return { applied: false, reason: 'order_not_found' };
  if (order.extrasAppliedAt) return { applied: false, reason: 'already_applied' };
  if (!order.tenantId) return { applied: false, reason: 'no_tenant_yet' };

  const bundles: Array<{ metric: PlanMetric; count: number }> = [
    { metric: PlanMetric.AI_CREDITS_PER_MONTH, count: order.extraAiBundles },
    { metric: PlanMetric.WA_MESSAGES_PER_MONTH, count: order.extraWhatsappBundles },
    { metric: PlanMetric.SMS_SEGMENTS_PER_MONTH, count: order.extraSmsBundles },
  ].filter((b) => b.count > 0);

  if (bundles.length === 0) {
    // Nothing to add, but still mark as "processed" so we don't keep
    // revisiting an order on every webhook retry.
    await prisma.checkoutOrder.update({
      where: { id: order.id },
      data: { extrasAppliedAt: new Date() },
    });
    return { applied: false, reason: 'no_bundles' };
  }

  const currentLimits = await resolveTenantLimits(order.tenantId);
  const reason = `${order.upgradeMethod ?? 'checkout'}:${order.id}`;

  await prisma.$transaction(async (tx) => {
    for (const b of bundles) {
      const base = currentLimits[b.metric];
      const included = base === -1 ? -1 : base + b.count * 100;
      await tx.tenantLimitOverride.create({
        data: {
          tenantId: order.tenantId!,
          metric: b.metric,
          included,
          reason,
        },
      });
    }
    await tx.checkoutOrder.update({
      where: { id: order.id },
      data: { extrasAppliedAt: new Date() },
    });
  });

  // Fetch slug for the deep link on the notification; cheap single read.
  const tenant = await prisma.tenant.findUnique({
    where: { id: order.tenantId },
    select: { slug: true },
  });
  const isUpgrade = order.upgradeMethod === 'xpay_upgrade';
  await publishNotification({
    tenantId: order.tenantId,
    kind: 'PLAN_UPGRADED',
    title: isUpgrade ? 'Plan upgraded' : 'Plan activated',
    body: `Your new limits are live${bundles.length ? ` (+${bundles.reduce((n, b) => n + b.count * 100, 0)} extra units)` : ''}.`,
    href: tenant?.slug
      ? `/t/${tenant.slug}/settings/subscription`
      : null,
  });

  return { applied: true };
}
