/**
 * Phase 5.5 M4 — per-tenant resolved limits.
 *
 * Returns a map of every PlanMetric → resolved cap.
 *   -1 → unlimited (no enforcement)
 *    0 → not included (paid surface blocked)
 *   >0 → numeric cap
 *
 * Resolution order, per metric:
 *   1. Most recent non-expired TenantLimitOverride row → wins.
 *   2. Subscription.plan.feature.included → base.
 *   3. No subscription or no feature row → 0 (safe default — blocks
 *      paid surfaces rather than silently allowing them).
 *
 * The "no subscription = 0" default catches both legacy tenants that
 * pre-date the 0007 backfill (none exist in prod after that migration)
 * AND a state we never want to ship by accident: a tenant whose
 * subscription was cleared. Defense in depth.
 */
import { PlanMetric, prisma } from '@getyn/db';

const ALL_METRICS: PlanMetric[] = [
  PlanMetric.CONTACTS,
  PlanMetric.EMAILS_PER_MONTH,
  PlanMetric.WA_MESSAGES_PER_MONTH,
  PlanMetric.SMS_SEGMENTS_PER_MONTH,
  PlanMetric.AI_CREDITS_PER_MONTH,
  PlanMetric.CUSTOM_SENDING_DOMAINS,
  PlanMetric.USER_SEATS,
];

export type ResolvedLimits = Record<PlanMetric, number>;

export async function resolveTenantLimits(
  tenantId: string,
): Promise<ResolvedLimits> {
  const [subscription, overrides] = await Promise.all([
    prisma.subscription.findUnique({
      where: { tenantId },
      include: {
        plan: { include: { features: true } },
      },
    }),
    prisma.tenantLimitOverride.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const out = {} as ResolvedLimits;
  const now = new Date();

  for (const metric of ALL_METRICS) {
    // 1) override?
    const override = overrides.find(
      (o) => o.metric === metric && (!o.expiresAt || o.expiresAt > now),
    );
    if (override) {
      out[metric] = override.included;
      continue;
    }
    // 2) plan feature?
    const feature = subscription?.plan.features.find((f) => f.metric === metric);
    if (feature) {
      out[metric] = feature.included;
      continue;
    }
    // 3) default to 0
    out[metric] = 0;
  }
  return out;
}

/**
 * Single-metric lookup. Same resolution logic; cheaper when callers
 * only need one cap (the common case — limit checks gate on one
 * metric at a time).
 */
export async function resolveTenantLimit(
  tenantId: string,
  metric: PlanMetric,
): Promise<number> {
  const all = await resolveTenantLimits(tenantId);
  return all[metric];
}
