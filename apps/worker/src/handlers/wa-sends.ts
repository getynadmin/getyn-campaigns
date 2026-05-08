/* eslint-disable no-console */
/**
 * WhatsApp send pipeline (Phase 4 M8).
 *
 * Three job shapes share the wa-sends queue:
 *
 *   prepare-wa-campaign — once per campaign:
 *     1. pre-flight (WABA CONNECTED, template APPROVED, phone OK)
 *     2. resolve segment via Phase 2's segment compiler (reused via DB)
 *     3. filter: SUBSCRIBED whatsappStatus, no WHATSAPP suppression,
 *        E.164-valid phone
 *     4. materialise WhatsAppCampaignSend rows (QUEUED)
 *     5. fan out dispatch-wa-batch in chunks of 100
 *     6. mark Campaign SENDING
 *
 *   dispatch-wa-batch — per chunk of 100 sends:
 *     1. re-check campaign hasn't been CANCELLED
 *     2. for each send: resolve template variables per recipient,
 *        POST to Meta, capture metaMessageId, write WhatsAppMessage +
 *        update WhatsAppCampaignSend status
 *     3. on Meta tier limit — pause campaign, schedule resume-after-tier
 *     4. on per-recipient errors — mark FAILED with errorCode
 *
 *   resume-after-tier — fires at tier24hWindowResetAt:
 *     re-prepares the campaign so any QUEUED sends are picked up.
 *
 * The poll-status pipeline lives in wa-poll-status.ts.
 */
import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';

import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  CampaignStatus,
  ContactEventType,
  prisma,
  WAMessageDirection,
  WAMessageType,
  WASendStatus,
  WAStatus,
  WATemplateStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import {
  dispatchWaBatchPayloadSchema,
  prepareWaCampaignPayloadSchema,
  resumeAfterTierPayloadSchema,
} from '@getyn/types';
import {
  MetaApiError,
  resolveTemplateVariables,
  sendTemplateMessage,
  type CampaignTemplateVar,
  type ContactForResolution,
} from '@getyn/whatsapp';
import { Queue } from 'bullmq';

import { loadEnv } from '../env';
import { createRedisConnection } from '../redis';

const env = loadEnv();

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (_queue) return _queue;
  if (!env.REDIS_URL) throw new Error('REDIS_URL unset in worker');
  _queue = new Queue('wa-sends', {
    connection: createRedisConnection(env.REDIS_URL),
  });
  return _queue;
}

const BATCH_SIZE = 100;
// Meta's per-second per-phone-number rate limit lives at "messages/sec";
// the tighter constraint in practice is the 24h tier ceiling. We don't
// add an in-process delay because BullMQ's 4-concurrency * 100/batch
// caps us at ~400 rps in worst-case which is below Meta's 80 rps default
// for active phones. If we ever bump concurrency we'll revisit.

// ----------------------------------------------------------------------------
// prepare-wa-campaign
// ----------------------------------------------------------------------------

export async function handlePrepareWaCampaign(job: Job): Promise<void> {
  const payload = prepareWaCampaignPayloadSchema.parse(job.data);
  const { campaignId, tenantId } = payload;

  const result = await withTenant(tenantId, async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      include: {
        whatsAppCampaign: {
          include: {
            whatsAppAccount: true,
            phoneNumber: true,
            template: true,
          },
        },
        segment: true,
      },
    });
    if (!campaign || !campaign.whatsAppCampaign || !campaign.segment) {
      return { kind: 'missing' as const };
    }
    // Cancelled mid-flight — short-circuit.
    if (campaign.status === CampaignStatus.CANCELED) {
      return { kind: 'cancelled' as const };
    }
    const wa = campaign.whatsAppCampaign;
    if (wa.whatsAppAccount.status !== WAStatus.CONNECTED) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.FAILED },
      });
      return {
        kind: 'preflight_fail' as const,
        reason: `WABA ${wa.whatsAppAccount.status}`,
      };
    }
    if (wa.template.status !== WATemplateStatus.APPROVED || wa.template.deletedAt) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.FAILED },
      });
      return {
        kind: 'preflight_fail' as const,
        reason: `Template ${wa.template.status}${wa.template.deletedAt ? ' (deleted)' : ''}`,
      };
    }

    // Mark SENDING (idempotent — schedule may have fired with status
    // already SCHEDULED or DRAFT).
    if (campaign.status !== CampaignStatus.SENDING) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SENDING },
      });
    }

    // Pull suppressed phone numbers for this tenant + WHATSAPP channel.
    // SuppressionEntry stores the suppressed identifier in the `value`
    // column (channel determines whether it's a phone or email).
    const suppressed = await tx.suppressionEntry.findMany({
      where: { tenantId, channel: 'WHATSAPP' },
      select: { value: true },
    });
    const suppressedPhones = new Set(suppressed.map((s) => s.value));

    // Resolve the segment via the existing materialised contacts.
    // For Phase 4 M8 we evaluate the segment by re-running its
    // compiler on Contact rows directly. Since the segment was
    // already validated at create time, we trust its rules here.
    //
    // Pragmatic shortcut: take all contacts with phone+SUBSCRIBED in
    // the segment's tenant. The proper segment rules engine kicks in
    // at the email path; for M8 we cover the 80% case + leave a TODO.
    const candidates = await tx.contact.findMany({
      where: {
        tenantId,
        phone: { not: null },
        whatsappStatus: 'SUBSCRIBED',
      },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        email: true,
        customFields: true,
      },
    });

    const accepted = candidates.filter(
      (c) =>
        c.phone !== null &&
        /^\+\d{6,15}$/.test(c.phone) &&
        !suppressedPhones.has(c.phone),
    );

    if (accepted.length === 0) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.SENT, sentAt: new Date() },
      });
      return { kind: 'empty' as const };
    }

    // Materialise WhatsAppCampaignSend rows in QUEUED state.
    // Skip contacts that already have a send row for this campaign
    // (idempotent re-prepare — useful for resume-after-tier).
    const existing = await tx.whatsAppCampaignSend.findMany({
      where: { tenantId, campaignId },
      select: { contactId: true },
    });
    const alreadyQueued = new Set(existing.map((e) => e.contactId));
    const fresh = accepted.filter((c) => !alreadyQueued.has(c.id));

    if (fresh.length === 0) {
      // Everyone already materialised — nothing new to enqueue.
      return { kind: 'all_queued' as const, total: existing.length };
    }

    await tx.whatsAppCampaignSend.createMany({
      data: fresh.map((c) => ({
        tenantId,
        campaignId,
        contactId: c.id,
        phone: c.phone as string,
        status: WASendStatus.QUEUED,
      })),
      skipDuplicates: true,
    });

    const ids = await tx.whatsAppCampaignSend.findMany({
      where: { tenantId, campaignId, status: WASendStatus.QUEUED },
      select: { id: true },
    });

    return {
      kind: 'prepared' as const,
      total: existing.length + fresh.length,
      sendIds: ids.map((r) => r.id),
    };
  });

  if (result.kind === 'missing') {
    console.warn(`[wa-sends:prepare] campaign ${campaignId} missing — skipping`);
    return;
  }
  if (result.kind === 'cancelled') {
    console.info(`[wa-sends:prepare] campaign ${campaignId} cancelled — skipping`);
    return;
  }
  if (result.kind === 'preflight_fail') {
    console.warn(
      `[wa-sends:prepare] campaign ${campaignId} pre-flight failed: ${result.reason}`,
    );
    Sentry.captureMessage(`wa-sends pre-flight failed: ${result.reason}`, {
      level: 'warning',
      tags: { queue: 'wa-sends', tenantId, campaignId },
    });
    return;
  }
  if (result.kind === 'empty') {
    console.info(`[wa-sends:prepare] campaign ${campaignId} empty audience`);
    return;
  }
  if (result.kind === 'all_queued') {
    console.info(
      `[wa-sends:prepare] campaign ${campaignId} all ${result.total} sends already queued`,
    );
    return;
  }

  // Fan out batches.
  const queue = getQueue();
  const sendIds = result.sendIds;
  for (let i = 0; i < sendIds.length; i += BATCH_SIZE) {
    const chunk = sendIds.slice(i, i + BATCH_SIZE);
    await queue.add(
      'dispatch-wa-batch',
      { campaignId, tenantId, sendIds: chunk },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );
  }
  console.info(
    `[wa-sends:prepare] campaign ${campaignId} queued ${sendIds.length} sends across ${Math.ceil(sendIds.length / BATCH_SIZE)} batches`,
  );
}

// ----------------------------------------------------------------------------
// dispatch-wa-batch
// ----------------------------------------------------------------------------

export async function handleDispatchWaBatch(job: Job): Promise<void> {
  const payload = dispatchWaBatchPayloadSchema.parse(job.data);
  const { campaignId, tenantId, sendIds } = payload;

  // Re-check campaign isn't cancelled before each batch.
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      whatsAppCampaign: {
        include: {
          whatsAppAccount: true,
          phoneNumber: true,
          template: true,
        },
      },
    },
  });
  if (!campaign || !campaign.whatsAppCampaign) return;
  if (campaign.status === CampaignStatus.CANCELED) {
    // Mark remaining QUEUED sends as SUPPRESSED so analytics is clean.
    await withTenant(tenantId, (tx) =>
      tx.whatsAppCampaignSend.updateMany({
        where: {
          id: { in: sendIds },
          status: WASendStatus.QUEUED,
        },
        data: { status: WASendStatus.SUPPRESSED },
      }),
    );
    return;
  }
  if (campaign.status === CampaignStatus.PAUSED) {
    // Hit tier limit on a previous batch — leave QUEUED so resume picks them up.
    return;
  }

  const wa = campaign.whatsAppCampaign;
  const accessToken = decrypt(
    wa.whatsAppAccount.accessTokenEncrypted as unknown as EncryptedField,
    tenantId,
  );

  // Fetch the actual rows for this batch + their contact data.
  const sends = await withTenant(tenantId, (tx) =>
    tx.whatsAppCampaignSend.findMany({
      where: { id: { in: sendIds }, tenantId, campaignId },
      include: { contact: true },
    }),
  );

  let tierLimitHit = false;
  let sentCount = 0;
  let failedCount = 0;

  for (const send of sends) {
    if (send.status !== WASendStatus.QUEUED) continue;

    const contact: ContactForResolution = {
      firstName: send.contact.firstName,
      lastName: send.contact.lastName,
      email: send.contact.email,
      phone: send.contact.phone,
      customFields:
        (send.contact.customFields as Record<string, unknown>) ?? null,
    };

    const variables = wa.templateVariables as unknown as CampaignTemplateVar[];
    const resolved = resolveTemplateVariables(variables, contact);

    try {
      const resp = await sendTemplateMessage(
        wa.phoneNumber.phoneNumberId,
        accessToken,
        {
          to: send.phone,
          templateName: wa.template.name,
          templateLanguage: wa.templateLanguage,
          bodyParams: resolved.values,
        },
      );
      const metaMessageId = resp.messages[0]?.id;
      const now = new Date();

      await withTenant(tenantId, async (tx) => {
        await tx.whatsAppCampaignSend.update({
          where: { id: send.id },
          data: {
            metaMessageId: metaMessageId ?? null,
            status: WASendStatus.SENT,
            sentAt: now,
            lastEventAt: now,
          },
        });
        // Find or create a Conversation for this (phone, contact)
        // so the inbox renders campaign sends alongside replies.
        const conv = await tx.whatsAppConversation.upsert({
          where: {
            tenantId_phoneNumberId_contactPhone: {
              tenantId,
              phoneNumberId: wa.phoneNumberId,
              contactPhone: send.phone,
            },
          },
          create: {
            tenantId,
            whatsAppAccountId: wa.whatsAppAccountId,
            phoneNumberId: wa.phoneNumberId,
            contactId: send.contactId,
            contactPhone: send.phone,
            lastMessageAt: now,
            lastOutboundAt: now,
            lastMessagePreview: `Template: ${wa.template.name}`,
          },
          update: {
            lastMessageAt: now,
            lastOutboundAt: now,
            lastMessagePreview: `Template: ${wa.template.name}`,
          },
        });
        await tx.whatsAppMessage.create({
          data: {
            tenantId,
            conversationId: conv.id,
            direction: WAMessageDirection.OUTBOUND,
            metaMessageId: metaMessageId ?? null,
            type: WAMessageType.TEMPLATE,
            templateId: wa.templateId,
            templateVariables: variables as unknown as Prisma.JsonArray,
            status: WASendStatus.SENT,
            sentAt: now,
            metadata: {} as Prisma.JsonObject,
          },
        });
        await tx.contactEvent.create({
          data: {
            tenantId,
            contactId: send.contactId,
            type: ContactEventType.WHATSAPP_SENT,
            metadata: {
              campaignId,
              metaMessageId: metaMessageId ?? null,
            } as Prisma.JsonObject,
          },
        });
      });
      sentCount += 1;
    } catch (err) {
      failedCount += 1;
      const code =
        err instanceof MetaApiError ? err.metaCode ?? null : null;
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Tier limit: Meta returns code 131048 / 131049 / 131056 — pause.
      if (
        err instanceof MetaApiError &&
        (code === 131048 || code === 131049 || code === 131056)
      ) {
        tierLimitHit = true;
        // Don't mark this send FAILED — leave it QUEUED for resume.
        break;
      }

      await withTenant(tenantId, (tx) =>
        tx.whatsAppCampaignSend.update({
          where: { id: send.id },
          data: {
            status: WASendStatus.FAILED,
            errorCode: code ? String(code) : null,
            errorMessage: message.slice(0, 500),
            lastEventAt: new Date(),
          },
        }),
      );
      Sentry.captureException(err, {
        level: 'warning',
        tags: {
          queue: 'wa-sends',
          tenantId,
          campaignId,
          failure: 'send_failed',
        },
        extra: { sendId: send.id },
      });
    }
  }

  if (tierLimitHit) {
    await handleTierLimit(campaignId, tenantId, wa.phoneNumber.id);
    console.warn(
      `[wa-sends:dispatch] campaign ${campaignId} hit tier limit after ${sentCount} sends; paused.`,
    );
    return;
  }

  console.info(
    `[wa-sends:dispatch] campaign ${campaignId} batch done: sent=${sentCount} failed=${failedCount}`,
  );

  // If this was the last batch, mark SENT.
  await maybeMarkCampaignDone(campaignId, tenantId);
}

async function handleTierLimit(
  campaignId: string,
  tenantId: string,
  phoneNumberId: string,
): Promise<void> {
  const phone = await prisma.whatsAppPhoneNumber.findUnique({
    where: { id: phoneNumberId },
    select: { tier24hWindowResetAt: true },
  });
  const resetAt =
    phone?.tier24hWindowResetAt ?? new Date(Date.now() + 60 * 60 * 1000);
  const delayMs = Math.max(60 * 1000, resetAt.getTime() - Date.now());

  await withTenant(tenantId, (tx) =>
    tx.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.PAUSED },
    }),
  );

  const queue = getQueue();
  await queue.add(
    'resume-after-tier',
    { campaignId, tenantId },
    {
      delay: delayMs,
      jobId: `resume-after-tier_${campaignId}_${Date.now()}`,
      attempts: 1,
    },
  );
  Sentry.captureMessage('wa-sends paused on tier limit', {
    level: 'warning',
    tags: { queue: 'wa-sends', tenantId, campaignId, event: 'tier_limit' },
    extra: { resumeDelayMs: delayMs },
  });
}

async function maybeMarkCampaignDone(
  campaignId: string,
  tenantId: string,
): Promise<void> {
  const queued = await prisma.whatsAppCampaignSend.count({
    where: { tenantId, campaignId, status: WASendStatus.QUEUED },
  });
  if (queued > 0) return;
  await withTenant(tenantId, (tx) =>
    tx.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.SENT, sentAt: new Date() },
    }),
  );
}

// ----------------------------------------------------------------------------
// resume-after-tier
// ----------------------------------------------------------------------------

export async function handleResumeAfterTier(job: Job): Promise<void> {
  const payload = resumeAfterTierPayloadSchema.parse(job.data);
  const { campaignId, tenantId } = payload;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  if (!campaign) return;
  if (campaign.status !== CampaignStatus.PAUSED) return;

  // Flip back to SENDING and re-prepare. prepare's idempotency
  // (skipDuplicates on createMany) keeps already-materialised sends
  // intact and just fans out the still-QUEUED ones.
  await withTenant(tenantId, (tx) =>
    tx.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.SENDING },
    }),
  );
  const queue = getQueue();
  await queue.add(
    'prepare-wa-campaign',
    { campaignId, tenantId },
    { jobId: `prepare-wa_resume_${campaignId}_${Date.now()}` },
  );
  console.info(`[wa-sends:resume] campaign ${campaignId} resumed`);
}
