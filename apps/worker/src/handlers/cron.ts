/* eslint-disable no-console */
import {
  CampaignEventType,
  CampaignStatus,
  prisma,
} from '@getyn/db';

/**
 * Cron-style maintenance jobs.
 *
 * Two jobs:
 *   1. dailyReset       — fires at 00:00 UTC each day. Zeros every
 *                         tenant's currentDailyCount, resumes PAUSED
 *                         campaigns that hit yesterday's cap.
 *   2. ratesDriftCorrect — fires hourly. Recomputes
 *                         cachedComplaintRate30d / cachedBounceRate30d
 *                         / cachedSendCount30d from raw CampaignEvent
 *                         to correct any drift in the incremental
 *                         updates the webhook handler does.
 *
 * Both run from the same Worker via BullMQ repeatable jobs. Setup
 * happens in apps/worker/src/index.ts on boot — `addRepeatableJob`
 * is idempotent so re-runs across restarts don't pile up duplicates.
 */

export async function handleDailyReset(): Promise<void> {
  console.info('[cron:daily-reset] starting');

  // Zero everyone's daily counters.
  const reset = await prisma.tenantSendingPolicy.updateMany({
    data: {
      currentDailyCount: 0,
      lastResetAt: new Date(),
    },
  });
  console.info(`[cron:daily-reset] reset ${reset.count} TenantSendingPolicy rows`);

  // Resume PAUSED campaigns. We only auto-resume campaigns that paused
  // because of a daily-cap hit (the most common cause). Suspension-
  // triggered FAILED campaigns stay failed — those need OWNER attention.
  //
  // Determining "paused due to daily cap" without a dedicated flag: any
  // campaign whose status=PAUSED and whose tenant isn't suspended.
  // Acceptable heuristic for MVP.
  const tenants = await prisma.tenantSendingPolicy.findMany({
    where: { suspendedAt: null },
    select: { tenantId: true },
  });
  const eligibleTenantIds = tenants.map((t) => t.tenantId);

  const resumed = await prisma.campaign.updateMany({
    where: {
      status: CampaignStatus.PAUSED,
      tenantId: { in: eligibleTenantIds },
    },
    data: { status: CampaignStatus.SENDING },
  });
  console.info(
    `[cron:daily-reset] resumed ${resumed.count} PAUSED campaigns (will pick up where they left off)`,
  );

  // Resumed campaigns need a fresh prepare-campaign trigger so the
  // dispatch-batch loop continues. We only re-enqueue prepare-campaign
  // for those we resumed; their existing CampaignSend rows in QUEUED
  // state will fire as the prepare handler chain-enqueues them.
  if (resumed.count > 0) {
    const { sendsQueueProducer } = await import('../queues/sends-producer');
    const resumedCampaigns = await prisma.campaign.findMany({
      where: {
        status: CampaignStatus.SENDING,
        tenantId: { in: eligibleTenantIds },
      },
      select: { id: true, tenantId: true },
    });
    for (const c of resumedCampaigns) {
      await sendsQueueProducer.add(
        'prepare-campaign',
        { campaignId: c.id, tenantId: c.tenantId },
        { jobId: `prepare-resume:${c.id}:${Date.now()}` },
      );
    }
  }
}

/**
 * Recompute cached 30-day rates from raw CampaignEvent. Drift-corrects
 * the incremental updates the webhook handler does on each event.
 *
 * Heavy query (count + group-by over 30 days of events). Acceptable
 * once an hour; would be expensive at higher cadence.
 */
export async function handleRatesDriftCorrect(): Promise<void> {
  console.info('[cron:rates-drift] starting');

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const tenants = await prisma.tenantSendingPolicy.findMany({
    select: { tenantId: true },
  });

  for (const { tenantId } of tenants) {
    const sent = await prisma.campaignEvent.count({
      where: {
        tenantId,
        type: CampaignEventType.SENT,
        occurredAt: { gte: cutoff },
      },
    });
    if (sent === 0) {
      await prisma.tenantSendingPolicy.update({
        where: { tenantId },
        data: {
          cachedSendCount30d: 0,
          cachedComplaintRate30d: 0,
          cachedBounceRate30d: 0,
          cachedRatesUpdatedAt: new Date(),
        },
      });
      continue;
    }

    const bounced = await prisma.campaignEvent.count({
      where: {
        tenantId,
        type: CampaignEventType.BOUNCED,
        occurredAt: { gte: cutoff },
      },
    });
    const complained = await prisma.campaignEvent.count({
      where: {
        tenantId,
        type: CampaignEventType.COMPLAINED,
        occurredAt: { gte: cutoff },
      },
    });

    await prisma.tenantSendingPolicy.update({
      where: { tenantId },
      data: {
        cachedSendCount30d: sent,
        cachedComplaintRate30d: complained / sent,
        cachedBounceRate30d: bounced / sent,
        cachedRatesUpdatedAt: new Date(),
      },
    });
  }

  console.info(`[cron:rates-drift] recomputed for ${tenants.length} tenants`);
}
