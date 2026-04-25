/* eslint-disable no-console */
import type { Job } from 'bullmq';
import { Resend } from 'resend';

import {
  CampaignEventType,
  CampaignStatus,
  CampaignSendStatus,
  Channel,
  ContactEventType,
  SubscriptionStatus,
  checkAndApplySuspension,
  compileSegmentRules,
  emitContactEvent,
  incrementSendCounters,
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

import { renderForRecipient, setupBatchRender } from './render';

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
/* dispatch-batch                                                             */
/* -------------------------------------------------------------------------- */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/**
 * Per-batch send rate. Resend's default tier is 10 req/s; with 4 worker
 * concurrency = up to 40 req/s if all batches send in parallel. We
 * throttle inside the batch loop: 100ms between sends → 10 req/s per
 * batch. Multiple batches still risk exceeding — Resend will 429 us
 * and our retry-on-429 backoff handles it.
 *
 * For a real production setup the right thing is a global token-bucket
 * limiter in Redis. Flagged for M9.
 */
const PER_SEND_DELAY_MS = 100;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleDispatchBatch(job: Job): Promise<void> {
  const payload = dispatchBatchPayloadSchema.parse(job.data);
  const { campaignId, tenantId, abVariant, sendIds } = payload;

  console.info(
    `[sends:dispatch] campaign=${campaignId} variant=${abVariant ?? 'none'} sends=${sendIds.length}`,
  );

  // Suspension barrier — re-check before doing any work. The worker may
  // have queued this batch hours ago; tenant could have been suspended
  // since then.
  const suspension = await prisma.$transaction((tx) =>
    checkAndApplySuspension(
      tx as unknown as Prisma.TransactionClient as never,
      tenantId,
    ),
  );
  if (suspension.shouldSuspend) {
    console.warn(
      `[sends:dispatch] campaign=${campaignId} skipped — tenant suspended: ${suspension.reason}`,
    );
    // Mark these sends as SUPPRESSED rather than FAILED — we didn't
    // actually fail to send, the sender was suspended. Different status
    // for analytics.
    await prisma.campaignSend.updateMany({
      where: { id: { in: sendIds }, status: CampaignSendStatus.QUEUED },
      data: {
        status: CampaignSendStatus.SUPPRESSED,
        errorMessage: `Tenant suspended: ${suspension.reason}`,
      },
    });
    return;
  }

  // Once-per-batch setup: load campaign + tenant + recipients + tracking
  // links. We do this inside withTenant so RLS applies.
  const setup = await withTenant(tenantId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { emailCampaign: true },
    });
    if (!campaign || !campaign.emailCampaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    if (campaign.status === CampaignStatus.CANCELED) {
      console.warn(
        `[sends:dispatch] campaign=${campaignId} canceled — skipping batch`,
      );
      return null;
    }
    if (!campaign.emailCampaign.renderedHtml) {
      throw new Error(`Campaign ${campaignId} has no renderedHtml.`);
    }

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        postalAddress: true,
        companyDisplayName: true,
      },
    });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    // For A/B campaigns, the per-variant subject lives on emailCampaign.abTest
    let subject = campaign.emailCampaign.subject;
    const abTestRaw = campaign.emailCampaign.abTest;
    if (abVariant && abTestRaw) {
      const ab = abTestSchema.parse(abTestRaw);
      const variant = ab.variants.find((v) => v.id === abVariant);
      if (variant) subject = variant.subject;
    }

    // Per-send rows + their contacts.
    const sends = await tx.campaignSend.findMany({
      where: { id: { in: sendIds }, status: CampaignSendStatus.QUEUED },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            customFields: true,
          },
        },
      },
    });

    // Tracking-link map for this campaign.
    const trackingLinks = await setupBatchRender(
      tx as unknown as Prisma.TransactionClient as never,
      {
        tenantId,
        campaignId,
        renderedHtml: campaign.emailCampaign.renderedHtml,
      },
    );

    return {
      tenant,
      campaign: {
        id: campaign.id,
        subject,
        previewText: campaign.emailCampaign.previewText,
        fromName: campaign.emailCampaign.fromName,
        fromEmail: campaign.emailCampaign.fromEmail,
        replyTo: campaign.emailCampaign.replyTo,
        renderedHtml: campaign.emailCampaign.renderedHtml,
      },
      sends,
      trackingLinks,
    };
  });

  if (!setup) return;

  // Per-recipient send loop. Sequential (with throttle) so we don't blow
  // past Resend's rate limit. Future improvement: parallel batches of
  // 10 with per-batch settle.
  let sentCount = 0;
  let failedCount = 0;

  for (const send of setup.sends) {
    if (!send.contact || !send.contact.email) continue;

    const rendered = renderForRecipient({
      campaignId,
      tenantId,
      appUrl: APP_URL,
      send: {
        id: send.id,
        email: send.email,
        abVariant: send.abVariant as AbVariantValue | null,
      },
      contact: {
        firstName: send.contact.firstName,
        lastName: send.contact.lastName,
        email: send.contact.email,
        customFields: (send.contact.customFields ?? {}) as Record<
          string,
          unknown
        >,
      },
      campaign: {
        subject: setup.campaign.subject,
        fromName: setup.campaign.fromName,
        fromEmail: setup.campaign.fromEmail,
        replyTo: setup.campaign.replyTo,
        renderedHtml: setup.campaign.renderedHtml,
      },
      tenant: setup.tenant,
      trackingLinks: setup.trackingLinks,
    });

    try {
      let messageId: string | null = null;
      if (resend) {
        const { data, error } = await resend.emails.send({
          from: rendered.fromAddress,
          to: send.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          replyTo: rendered.replyTo ?? undefined,
          headers: {
            // RFC 8058 one-click unsubscribe. Mail clients POST to the
            // URL on the user's button press; our /api/unsubscribe/[token]
            // handler accepts the empty POST body.
            //
            // The visible Unsubscribe link in the email body points to
            // /u/[token] (the confirmation page — GET handles that).
            // Both flow to the same DB write via verifyEmailToken.
            'List-Unsubscribe': `<${APP_URL}/api/unsubscribe/${
              (await import('@getyn/db')).signEmailToken({
                campaignSendId: send.id,
                tenantId,
                kind: 'unsubscribe',
              })
            }>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        if (error) throw new Error(error.message);
        messageId = data?.id ?? null;
      } else {
        // Stub mode (no RESEND_API_KEY) — log only.
        console.info(
          `[sends:dispatch:stub] would send to=${send.email} subject="${rendered.subject}"`,
        );
        messageId = `stub-${send.id}`;
      }

      const sentAt = new Date();
      await withTenant(tenantId, async (tx) => {
        await tx.campaignSend.update({
          where: { id: send.id },
          data: {
            status: CampaignSendStatus.SENT,
            messageId,
            sentAt,
            lastEventAt: sentAt,
          },
        });
        await tx.campaignEvent.create({
          data: {
            tenantId,
            campaignSendId: send.id,
            campaignId,
            type: CampaignEventType.SENT,
            occurredAt: sentAt,
          },
        });
        await emitContactEvent(tx, {
          tenantId,
          contactId: send.contactId,
          type: ContactEventType.EMAIL_SENT,
          metadata: { campaignId, messageId },
          occurredAt: sentAt,
        });
      });
      sentCount++;
    } catch (err) {
      failedCount++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[sends:dispatch] send ${send.id} failed: ${message}`,
      );
      await prisma.campaignSend.update({
        where: { id: send.id },
        data: {
          status: CampaignSendStatus.FAILED,
          errorMessage: message.slice(0, 500),
          lastEventAt: new Date(),
        },
      });
      // Don't emit ContactEvent for FAILED — it's our infra problem,
      // not the contact's. CampaignEvent is enough for analytics.
      await prisma.campaignEvent.create({
        data: {
          tenantId,
          campaignSendId: send.id,
          campaignId,
          type: CampaignEventType.FAILED,
          metadata: { errorMessage: message.slice(0, 500) },
          occurredAt: new Date(),
        },
      });
    }

    if (PER_SEND_DELAY_MS > 0) await sleep(PER_SEND_DELAY_MS);
  }

  // Update tenant counters and check daily cap.
  if (sentCount > 0) {
    const counters = await prisma.$transaction((tx) =>
      incrementSendCounters(
        tx as unknown as Prisma.TransactionClient as never,
        { tenantId, sentCount },
      ),
    );
    if (counters.dailyCapExceeded) {
      console.warn(
        `[sends:dispatch] tenant=${tenantId} daily cap exceeded — pausing remaining batches`,
      );
      // PAUSE the campaign — daily cron will resume it tomorrow.
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.PAUSED },
      });
    }
  }

  // Did this batch finish the campaign? Check if any QUEUED sends remain.
  const remaining = await prisma.campaignSend.count({
    where: {
      tenantId,
      campaignId,
      status: CampaignSendStatus.QUEUED,
    },
  });
  if (remaining === 0) {
    // Verify the campaign isn't an A/B test waiting on the held-back
    // cohort (those start as QUEUED with abVariant=null after the
    // winner is picked — so remaining=0 here only means "done" if not
    // A/B or the held-back cohort was already queued).
    const c = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { emailCampaign: { select: { abTest: true } } },
    });
    const ab = c?.emailCampaign?.abTest as
      | { status?: string }
      | null
      | undefined;
    const isAbWaitingForWinner =
      ab && ab.status !== 'completed' && ab.status !== undefined;
    if (!isAbWaitingForWinner && c?.status === CampaignStatus.SENDING) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SENT, sentAt: new Date() },
      });
      console.info(
        `[sends:dispatch] campaign=${campaignId} done — marked SENT`,
      );
    }
  }

  console.info(
    `[sends:dispatch] campaign=${campaignId} batch done — sent=${sentCount} failed=${failedCount}`,
  );
}

/* -------------------------------------------------------------------------- */
/* evaluate-ab                                                                */
/* -------------------------------------------------------------------------- */

async function handleEvaluateAb(job: Job): Promise<void> {
  const payload = evaluateAbPayloadSchema.parse(job.data);
  const { campaignId, tenantId } = payload;

  console.info(`[sends:evaluate-ab] campaign=${campaignId}`);

  const result = await withTenant(tenantId, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { emailCampaign: true },
    });
    if (!campaign || !campaign.emailCampaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    if (campaign.status === CampaignStatus.CANCELED) return { skipped: true };

    const ab = abTestSchema.parse(campaign.emailCampaign.abTest);
    if (ab.status === 'winner_selected' || ab.status === 'completed') {
      return { skipped: true, reason: 'already decided' };
    }

    // Per-variant aggregates from CampaignSend status (cheap — indexed).
    const aRows = await tx.campaignSend.findMany({
      where: { campaignId, abVariant: 'A', tenantId },
      select: { status: true },
    });
    const bRows = await tx.campaignSend.findMany({
      where: { campaignId, abVariant: 'B', tenantId },
      select: { status: true },
    });

    const stats = (rows: typeof aRows): { sent: number; opened: number; clicked: number } => {
      let sent = 0;
      let opened = 0;
      let clicked = 0;
      for (const r of rows) {
        if (
          r.status === CampaignSendStatus.SENT ||
          r.status === CampaignSendStatus.DELIVERED ||
          r.status === CampaignSendStatus.OPENED ||
          r.status === CampaignSendStatus.CLICKED
        )
          sent++;
        if (
          r.status === CampaignSendStatus.OPENED ||
          r.status === CampaignSendStatus.CLICKED
        )
          opened++;
        if (r.status === CampaignSendStatus.CLICKED) clicked++;
      }
      return { sent, opened, clicked };
    };
    const aStats = stats(aRows);
    const bStats = stats(bRows);

    // Sample-size floor — fallback to A if either variant lacks volume.
    const minN = ab.minSendsPerVariant;
    let winner: 'A' | 'B' = 'A';
    let chosenReason: string;
    if (aStats.sent < minN || bStats.sent < minN) {
      chosenReason = `Sample too small (A=${aStats.sent}, B=${bStats.sent}, min=${minN}); falling back to A.`;
    } else {
      const aRate =
        ab.winnerMetric === 'open_rate'
          ? aStats.opened / aStats.sent
          : aStats.clicked / aStats.sent;
      const bRate =
        ab.winnerMetric === 'open_rate'
          ? bStats.opened / bStats.sent
          : bStats.clicked / bStats.sent;
      if (bRate > aRate) winner = 'B';
      chosenReason = `${ab.winnerMetric}: A=${(aRate * 100).toFixed(2)}% B=${(bRate * 100).toFixed(2)}% → ${winner} wins`;
    }

    const updatedAb: AbTest = {
      ...ab,
      status: 'winner_selected',
      winnerVariantId: winner,
      winnerDecidedAt: new Date().toISOString(),
    };
    await tx.emailCampaign.update({
      where: { id: campaign.emailCampaign.id },
      data: { abTest: updatedAb as object },
    });

    return { skipped: false, winner, reason: chosenReason };
  });

  if (result.skipped) return;

  // Release the held-back cohort with the winning variant.
  const heldBack = await prisma.campaignSend.findMany({
    where: {
      tenantId,
      campaignId,
      abVariant: null,
      status: CampaignSendStatus.QUEUED,
    },
    select: { id: true },
  });

  if (heldBack.length === 0) {
    console.info(
      `[sends:evaluate-ab] campaign=${campaignId} no held-back cohort to release`,
    );
    return;
  }

  // Assign the winner variant to held-back rows so dispatch-batch knows
  // which subject to use.
  await prisma.campaignSend.updateMany({
    where: {
      tenantId,
      campaignId,
      abVariant: null,
      status: CampaignSendStatus.QUEUED,
    },
    data: { abVariant: result.winner },
  });

  const { sendsQueueProducer } = await import('../queues/sends-producer');
  for (let i = 0; i < heldBack.length; i += 500) {
    const chunk = heldBack.slice(i, i + 500);
    await sendsQueueProducer.add(
      JOB_NAMES.sends.dispatchBatch,
      {
        campaignId,
        tenantId,
        abVariant: result.winner,
        sendIds: chunk.map((s) => s.id),
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    );
  }
  console.info(
    `[sends:evaluate-ab] campaign=${campaignId} winner=${result.winner} (${result.reason}); released ${heldBack.length} held-back sends`,
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
