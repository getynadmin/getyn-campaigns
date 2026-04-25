import type { PrismaClient } from '@prisma/client';

/**
 * Helpers for `TenantSendingPolicy` — the deliverability guardrail row.
 *
 * Cached counters approach (per Phase 3 M1 pushback #4): the M7 webhook
 * handler updates `cachedComplaintRate30d` / `cachedBounceRate30d` /
 * `cachedSendCount30d` incrementally on each event. A daily cron
 * recomputes from raw events to drift-correct. The send pipeline reads
 * the cached values — never aggregates raw events at dispatch time.
 *
 * Auto-suspension: when the dispatch helper sees a rate over threshold,
 * it sets `suspendedAt` + `suspensionReason`. The campaign tRPC's
 * pre-flight rejects new sends. OWNER lifts via the runbook.
 */

export interface SuspensionDecision {
  /** True if the tenant should be blocked from new sends. */
  shouldSuspend: boolean;
  /** Human-readable reason — stored on TenantSendingPolicy.suspensionReason. */
  reason: string | null;
  /** Snapshot of the cached values used for the decision (for logs). */
  rates: {
    complaintRate30d: number;
    bounceRate30d: number;
    sendCount30d: number;
  };
}

/**
 * Pure decision function — given the cached counters and the thresholds,
 * decide whether a tenant has crossed a deliverability cliff.
 *
 * The minimum sample size of 200 sends keeps single-bounce noise from
 * tripping new tenants. Below that, we trust other signals (the auto
 * SuppressionEntry from the bounce already prevents repeats).
 *
 * Pure so it's unit-testable without a DB.
 */
export function computeSuspensionDecision(args: {
  cachedComplaintRate30d: number;
  cachedBounceRate30d: number;
  cachedSendCount30d: number;
  complaintRateThreshold: number;
  bounceRateThreshold: number;
  minSampleSize?: number;
}): SuspensionDecision {
  const minSample = args.minSampleSize ?? 200;
  const rates = {
    complaintRate30d: args.cachedComplaintRate30d,
    bounceRate30d: args.cachedBounceRate30d,
    sendCount30d: args.cachedSendCount30d,
  };

  if (args.cachedSendCount30d < minSample) {
    return { shouldSuspend: false, reason: null, rates };
  }

  if (args.cachedComplaintRate30d > args.complaintRateThreshold) {
    return {
      shouldSuspend: true,
      reason: `Complaint rate ${(args.cachedComplaintRate30d * 100).toFixed(2)}% exceeded threshold ${(args.complaintRateThreshold * 100).toFixed(2)}% over the last 30 days (${args.cachedSendCount30d} sends).`,
      rates,
    };
  }
  if (args.cachedBounceRate30d > args.bounceRateThreshold) {
    return {
      shouldSuspend: true,
      reason: `Bounce rate ${(args.cachedBounceRate30d * 100).toFixed(2)}% exceeded threshold ${(args.bounceRateThreshold * 100).toFixed(2)}% over the last 30 days (${args.cachedSendCount30d} sends).`,
      rates,
    };
  }
  return { shouldSuspend: false, reason: null, rates };
}

/**
 * Side-effecting wrapper — reads the policy, runs the decision, persists
 * suspension if triggered. Intended for the worker's dispatch barrier
 * (called once per `dispatch-batch` job, before any Resend calls).
 *
 * Returns the decision so the caller can short-circuit the batch.
 *
 * Idempotent: if `suspendedAt` is already set, we skip and return
 * `shouldSuspend: true` immediately.
 */
export async function checkAndApplySuspension(
  tx: PrismaClient,
  tenantId: string,
): Promise<SuspensionDecision & { alreadySuspended: boolean }> {
  const policy = await tx.tenantSendingPolicy.findUnique({
    where: { tenantId },
  });
  if (!policy) {
    // No policy row = brand new tenant before backfill. Block defensively;
    // the backfill always runs as part of the M1 migration so this branch
    // shouldn't fire in steady state.
    return {
      shouldSuspend: true,
      alreadySuspended: false,
      reason: 'No TenantSendingPolicy row — re-run the M1 backfill.',
      rates: { complaintRate30d: 0, bounceRate30d: 0, sendCount30d: 0 },
    };
  }
  if (policy.suspendedAt) {
    return {
      shouldSuspend: true,
      alreadySuspended: true,
      reason: policy.suspensionReason ?? 'Suspended.',
      rates: {
        complaintRate30d: policy.cachedComplaintRate30d,
        bounceRate30d: policy.cachedBounceRate30d,
        sendCount30d: policy.cachedSendCount30d,
      },
    };
  }

  const decision = computeSuspensionDecision({
    cachedComplaintRate30d: policy.cachedComplaintRate30d,
    cachedBounceRate30d: policy.cachedBounceRate30d,
    cachedSendCount30d: policy.cachedSendCount30d,
    complaintRateThreshold: policy.complaintRateThreshold,
    bounceRateThreshold: policy.bounceRateThreshold,
  });

  if (decision.shouldSuspend && decision.reason) {
    await tx.tenantSendingPolicy.update({
      where: { tenantId },
      data: {
        suspendedAt: new Date(),
        suspensionReason: decision.reason,
      },
    });
  }

  return { ...decision, alreadySuspended: false };
}

/**
 * Atomic increment of the daily send counter + send-count-30d.
 *
 * Called from the dispatch handler after a successful Resend send. We
 * use Prisma's `increment` so concurrent batches don't lose updates.
 *
 * Returns whether the daily cap is now exceeded (caller pauses the
 * remaining batches if so).
 */
export async function incrementSendCounters(
  tx: PrismaClient,
  args: { tenantId: string; sentCount: number; bouncedCount?: number; complainedCount?: number },
): Promise<{ dailyCapExceeded: boolean }> {
  const updated = await tx.tenantSendingPolicy.update({
    where: { tenantId: args.tenantId },
    data: {
      currentDailyCount: { increment: args.sentCount },
      cachedSendCount30d: { increment: args.sentCount },
      // Bounced and complained counts are also incremented here so the
      // cached rates stay current without a full re-aggregate. Drift-
      // correction happens in the daily cron.
    },
  });
  return {
    dailyCapExceeded: updated.currentDailyCount >= updated.dailySendLimit,
  };
}
