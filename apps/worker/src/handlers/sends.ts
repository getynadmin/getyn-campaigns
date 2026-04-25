/* eslint-disable no-console */
import type { Job } from 'bullmq';

import {
  CampaignStatus,
  CampaignSendStatus,
  Channel,
  SubscriptionStatus,
  checkAndApplySuspension,
  compileSegmentRules,
  prisma,
  withTenant,
  type Prisma,
} from '@getyn/db';
import {
  abTestSchema,
  dispatchBatchPayloadSchema,
  evaluateAbPayloadSchema,
  JOB_NAMES,
  prepareCampaignPayloadSchema,
  segmentRulesSchema,
  type AbTest,
  type AbVariantValue,
} from '@getyn/types';

/**
 * `sends` queue handlers — Phase 3 M6.
 *
 * Three job types share this queue:
 *   1. `prepare-campaign` (M6a)  — resolve segment, filter by suppression,
 *                                  materialize CampaignSend rows, enqueue
 *                                  dispatch-batch chunks.
 *   2. `dispatch-batch` (M6b)    — render per-recipient HTML, call Resend,
 *                                  emit events. Implemented in M6b.
 *   3. `evaluate-ab` (M6b)       — pick A/B winner, release held-back cohort.
 *
 * The job's `name` field disambiguates which handler to run. We register a
 * single Worker for the queue and dispatch to the right function inside.
 */

const DISPATCH_CHUNK_SIZE = 500;

export async function handleSendsJob(job: Job): Promise<void> {
  switch (job.name) {
    case JOB_NAMES.sends.prepareCampaign:
      return handlePrepareCampaign(job);
    case JOB_NAMES.sends.dispatchBatch:
      return handleDispatchBatch(job);
    case JOB_NAMES.sends.evaluateAb:
      return handleEvaluateAb(job);
    default:
      throw new Error(`Unknown sends job name: ${job.name}`);
  }
}

/* -------------------------------------------------------------------------- */
/* prepare-campaign                                                           */
/* -------------------------------------------------------------------------- */

async function handlePrepareCampaign(job: Job): Promise<void> {
  const payload = prepareCampaignPayloadSchema.parse(job.data);
  const { campaignId, tenantId } = payload;

  console.info(`[sends:prepare] campaign=${campaignId} tenant=${tenantId}`);

  // Suspension check — bail out before doing any work if the tenant is
  // already blocked.
  const suspension = await prisma.$transaction((tx) =>
    checkAndApplySuspension(
      tx as unknown as Prisma.TransactionClient as never,
      tenantId,
    ),
  );
  if (suspension.shouldSuspend) {
    await markCampaignFailed(
      campaignId,
      tenantId,
      `Tenant is suspended: ${suspension.reason ?? 'unknown'}`,
    );
    return;
  }

  // Inside withTenant so RLS applies and writes are scoped.
  const result = await withTenant(tenantId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { emailCampaign: true },
    });
    if (!campaign || !campaign.emailCampaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    if (campaign.status !== CampaignStatus.SENDING) {
      // Worker picked the job up but the campaign isn't in SENDING state.
      // Could be: user canceled, or schedule fired but campaign was edited.
      // Treat as no-op rather than fail.
      console.warn(
        `[sends:prepare] campaign ${campaignId} status=${campaign.status}, skipping`,
      );
      return { skipped: true };
    }
    if (!campaign.emailCampaign.renderedHtml) {
      throw new Error(
        `Campaign ${campaignId} has no renderedHtml. Pre-flight should have caught this.`,
      );
    }

    // Resolve segment to a Prisma WHERE clause + apply suppression filter.
    const segment = await tx.segment.findUnique({
      where: { id: campaign.segmentId },
    });
    if (!segment) throw new Error(`Segment ${campaign.segmentId} not found`);
    const rules = segmentRulesSchema.parse(segment.rules);

    const customFields = await tx.customField.findMany({
      where: { tenantId },
      select: { id: true, key: true, type: true },
    });
    const compiled = compileSegmentRules(rules, { customFields });

    // Pull the suppression list once. For tenants with millions of
    // suppressions this would need a streaming approach; for now we hold
    // the email set in memory.
    const suppressions = await tx.suppressionEntry.findMany({
      where: { tenantId, channel: Channel.EMAIL },
      select: { value: true },
    });
    const suppressedEmails = new Set(suppressions.map((s) => s.value));

    // Reachable recipients: subscribed, has email, matches segment, not
    // on suppression list. We pull (id, email) pairs in batches via
    // cursor pagination to bound memory for large segments.
    const recipients: { id: string; email: string }[] = [];
    let cursor: string | null = null;
    const batchSize = 1000;
    /* eslint-disable no-constant-condition */
    while (true) {
      const rows: { id: string; email: string | null }[] =
        await tx.contact.findMany({
          where: {
            AND: [
              { tenantId, deletedAt: null },
              { email: { not: null } },
              { emailStatus: SubscriptionStatus.SUBSCRIBED },
              compiled,
            ],
          },
          select: { id: true, email: true },
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      if (rows.length === 0) break;
      for (const r of rows) {
        if (r.email && !suppressedEmails.has(r.email)) {
          recipients.push({ id: r.id, email: r.email });
        }
      }
      const last = rows[rows.length - 1];
      cursor = last ? last.id : null;
      if (rows.length < batchSize) break;
    }
    /* eslint-enable no-constant-condition */

    if (recipients.length === 0) {
      await tx.campaign.update({
        where: { id: campaign.id },
        data: { status: CampaignStatus.SENT, sentAt: new Date() },
      });
      console.info(
        `[sends:prepare] campaign=${campaignId} no recipients after filters — marked SENT (0 sends)`,
      );
      return { skipped: false, recipientCount: 0 };
    }

    // A/B test cohort split.
    //
    // When abTest is enabled with `testPercent = 20`, the first 20% goes
    // to variant A, the next 20% to variant B, the remaining 60% gets
    // assigned the winner later (held back as `abVariant: null`). The
    // shuffle below ensures the cohort is random, not biased by `id` order.
    const abTestRaw = campaign.emailCampaign.abTest;
    const abTest: AbTest | null =
      abTestRaw && (abTestRaw as { enabled?: boolean }).enabled === true
        ? abTestSchema.parse(abTestRaw)
        : null;

    const shuffled = shuffleStable(recipients, campaign.id);

    // Determine variant assignment per recipient.
    const assignments: { id: string; email: string; variant: AbVariantValue | null }[] =
      [];
    if (abTest) {
      const testPct = abTest.testPercent / 100; // 0.10 .. 0.50
      const variantACount = Math.floor(shuffled.length * testPct);
      const variantBCount = Math.floor(shuffled.length * testPct);
      shuffled.forEach((r, i) => {
        const variant: AbVariantValue | null =
          i < variantACount
            ? 'A'
            : i < variantACount + variantBCount
              ? 'B'
              : null;
        assignments.push({ id: r.id, email: r.email, variant });
      });
    } else {
      shuffled.forEach((r) => {
        assignments.push({ id: r.id, email: r.email, variant: null });
      });
    }

    // Materialize CampaignSend rows in QUEUED status, in batches of 500
    // (Prisma's createMany is the fast path).
    let createdRows = 0;
    for (let i = 0; i < assignments.length; i += DISPATCH_CHUNK_SIZE) {
      const chunk = assignments.slice(i, i + DISPATCH_CHUNK_SIZE);
      const result = await tx.campaignSend.createMany({
        data: chunk.map((c) => ({
          tenantId,
          campaignId: campaign.id,
          contactId: c.id,
          email: c.email,
          status: CampaignSendStatus.QUEUED,
          abVariant: c.variant,
        })),
        skipDuplicates: true,
      });
      createdRows += result.count;
    }

    return {
      skipped: false,
      recipientCount: createdRows,
      abTest,
    };
  });

  if (!result || result.skipped || result.recipientCount === 0) {
    return;
  }

  // Re-fetch the inserted CampaignSend ids and chunk them into
  // dispatch-batch jobs. We do this OUTSIDE the withTenant transaction
  // because BullMQ enqueue isn't a DB op and we want the jobs visible to
  // the worker as soon as possible.
  const sends = await prisma.campaignSend.findMany({
    where: {
      tenantId,
      campaignId,
      status: CampaignSendStatus.QUEUED,
    },
    select: { id: true, abVariant: true },
    orderBy: { id: 'asc' },
  });

  // Group sends by abVariant so each dispatch-batch job has a uniform
  // variant. The held-back cohort (variant=null) is enqueued ONLY for
  // non-A/B campaigns. For A/B, variant=null sends sit until evaluate-ab
  // releases them with the winner.
  const groups: Record<'A' | 'B' | 'null', string[]> = {
    A: [],
    B: [],
    null: [],
  };
  for (const s of sends) {
    const key = (s.abVariant ?? 'null') as 'A' | 'B' | 'null';
    groups[key].push(s.id);
  }

  const { sendsQueueProducer } = await import('../queues/sends-producer');

  // Helper to enqueue a series of dispatch-batch jobs.
  const enqueueChunks = async (
    sendIds: string[],
    variant: AbVariantValue | null,
  ): Promise<void> => {
    for (let i = 0; i < sendIds.length; i += DISPATCH_CHUNK_SIZE) {
      const chunk = sendIds.slice(i, i + DISPATCH_CHUNK_SIZE);
      await sendsQueueProducer.add(
        JOB_NAMES.sends.dispatchBatch,
        { campaignId, tenantId, abVariant: variant, sendIds: chunk },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      );
    }
  };

  if (result.abTest) {
    // Test cohort fires now.
    await enqueueChunks(groups.A, 'A');
    await enqueueChunks(groups.B, 'B');
    // Held-back cohort waits — evaluate-ab fires after the decision
    // window, then enqueues the rest with the winning variant.
    await sendsQueueProducer.add(
      JOB_NAMES.sends.evaluateAb,
      { campaignId, tenantId },
      {
        delay: result.abTest.winnerDecisionAfterMinutes * 60_000,
      },
    );
    console.info(
      `[sends:prepare] campaign=${campaignId} A/B test enqueued: A=${groups.A.length}, B=${groups.B.length}, held-back=${groups.null.length}`,
    );
  } else {
    await enqueueChunks(groups.null, null);
    console.info(
      `[sends:prepare] campaign=${campaignId} enqueued ${groups.null.length} sends across ${Math.ceil(groups.null.length / DISPATCH_CHUNK_SIZE)} batches`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* dispatch-batch — stub for M6a; full impl in M6b                             */
/* -------------------------------------------------------------------------- */

async function handleDispatchBatch(job: Job): Promise<void> {
  const payload = dispatchBatchPayloadSchema.parse(job.data);
  console.warn(
    `[sends:dispatch] M6b NOT IMPLEMENTED YET — would dispatch ${payload.sendIds.length} sends for campaign ${payload.campaignId} variant=${payload.abVariant}`,
  );
  // Intentionally no-op; M6b adds the real Resend dispatch.
  // Without this stub, the Worker's lock would expire and the job would
  // retry forever. Returning success keeps the queue clean for the M6a
  // checkpoint.
}

/* -------------------------------------------------------------------------- */
/* evaluate-ab — stub for M6a; full impl in M6b                                */
/* -------------------------------------------------------------------------- */

async function handleEvaluateAb(job: Job): Promise<void> {
  const payload = evaluateAbPayloadSchema.parse(job.data);
  console.warn(
    `[sends:evaluate-ab] M6b NOT IMPLEMENTED YET — would pick winner for campaign ${payload.campaignId}`,
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function markCampaignFailed(
  campaignId: string,
  tenantId: string,
  reason: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.FAILED },
    }),
  );
  console.error(`[sends:prepare] campaign=${campaignId} FAILED: ${reason}`);
}

/**
 * Stable shuffle keyed on a campaignId-derived seed. Same campaign always
 * shuffles the same way — useful for reproducing test-cohort splits.
 *
 * Mulberry32 PRNG seeded by FNV-1a hash of the campaign id. Cryptographic
 * quality isn't required; we just want unbiased order.
 */
function shuffleStable<T>(items: readonly T[], seedString: string): T[] {
  const out = [...items];
  let seed = 2166136261;
  for (let i = 0; i < seedString.length; i++) {
    seed ^= seedString.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
