/**
 * Phase 5.5 M4 — paid-surface gate.
 *
 * Drop into a tRPC mutation after `assertTenantActive`:
 *
 *   await assertWithinLimit(tenantId, PlanMetric.EMAILS_PER_MONTH, recipients);
 *
 * Throws FORBIDDEN with a customer-facing message when the action
 * would push the tenant over their resolved cap. The message is the
 * one we surface in the upgrade banner, so it deliberately reads
 * like product copy, not a stack trace.
 */
import { TRPCError } from '@trpc/server';
import * as Sentry from '@sentry/nextjs';

import { PlanMetric } from '@getyn/db';

import { getCurrentUsage } from './measure-usage';
import { resolveTenantLimit } from './resolve-limits';

const METRIC_LABEL: Record<PlanMetric, string> = {
  CONTACTS: 'contacts',
  EMAILS_PER_MONTH: 'emails this month',
  WA_MESSAGES_PER_MONTH: 'WhatsApp messages this month',
  SMS_SEGMENTS_PER_MONTH: 'SMS segments this month',
  AI_CREDITS_PER_MONTH: 'AI credits this month',
  CUSTOM_SENDING_DOMAINS: 'sending domains',
  USER_SEATS: 'user seats',
  AI_AGENT_CONVERSATIONS_PER_MONTH: 'AI agent conversations this month',
  AUTOMATION_ENROLLMENTS_PER_MONTH: 'automation enrollments this month',
  AGENT_REPLIES_PER_MONTH: 'email agent replies this month',
  MESSAGES_PER_MONTH: 'messages this month (email + WhatsApp)',
};

export interface LimitCheckResult {
  metric: PlanMetric;
  limit: number;
  current: number;
  delta: number;
  /** True when limit is -1 (unlimited) or current+delta ≤ limit. */
  allowed: boolean;
}

/**
 * Compute usage + cap for a metric. Used by `assertWithinLimit` and by
 * the tenant subscription page (M5) to render progress bars without
 * triggering the throw.
 *
 * Unlimited (`-1`) short-circuits the usage count — no DB hit. Worth
 * it because hot mutations call this every request.
 */
export async function checkLimit(
  tenantId: string,
  metric: PlanMetric,
  delta = 1,
): Promise<LimitCheckResult> {
  const limit = await resolveTenantLimit(tenantId, metric);
  if (limit === -1) {
    return { metric, limit, current: 0, delta, allowed: true };
  }
  const current = await getCurrentUsage(tenantId, metric);
  const allowed = current + delta <= limit;
  return { metric, limit, current, delta, allowed };
}

/**
 * Metrics that also participate in the unified MESSAGES_PER_MONTH
 * bucket. Callers gating on either of these will additionally get
 * checked against the shared cap so dynamic plans work without
 * touching every send path.
 */
const CONTRIBUTES_TO_MESSAGES: ReadonlySet<PlanMetric> = new Set([
  PlanMetric.EMAILS_PER_MONTH,
  PlanMetric.WA_MESSAGES_PER_MONTH,
]);

export async function assertWithinLimit(
  tenantId: string,
  metric: PlanMetric,
  delta = 1,
): Promise<void> {
  const result = await checkLimit(tenantId, metric, delta);
  if (!result.allowed) {
    throwLimitError(result);
  }
  // Also gate on the unified bucket when the per-channel metric feeds
  // into it. resolveTenantLimit defaults MESSAGES_PER_MONTH to
  // unlimited (-1) on legacy plans, so this is a no-op there.
  if (CONTRIBUTES_TO_MESSAGES.has(metric)) {
    const unified = await checkLimit(
      tenantId,
      PlanMetric.MESSAGES_PER_MONTH,
      delta,
    );
    if (!unified.allowed) throwLimitError(unified);
  }
}

function throwLimitError(result: LimitCheckResult): never {
  const label = METRIC_LABEL[result.metric];
  const message =
    result.limit === 0
      ? `Your plan doesn't include ${label}. Upgrade to unlock this feature.`
      : `You'd exceed your ${label} limit (${result.current}/${result.limit}). Upgrade your plan or request a higher limit.`;
  Sentry.captureMessage('billing.limit.exceeded', {
    level: 'warning',
    tags: { metric: result.metric, kind: 'plan_limit' },
    extra: {
      limit: result.limit,
      current: result.current,
      delta: result.delta,
    },
  });
  throw new TRPCError({ code: 'FORBIDDEN', message });
}
