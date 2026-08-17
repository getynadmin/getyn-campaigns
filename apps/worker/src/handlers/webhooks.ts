/* eslint-disable no-console */
import type { Job } from 'bullmq';

import {
  CampaignEventType,
  CampaignSendStatus,
  Channel,
  ContactEventType,
  ContactChannelStatus,
  SuppressionReason,
  emitContactEvent,
  prisma,
  upsertSuppressionEntry,
  withTenant,
} from '@getyn/db';
import { resendWebhookPayloadSchema } from '@getyn/types';

/**
 * Resend webhook event handler.
 *
 * The web's /api/webhooks/resend route signs/verifies, then enqueues
 * payloads here. This handler maps Resend event types → CampaignEvent +
 * CampaignSend.status updates + auto-suppression on hard bounce /
 * complaint.
 *
 * Idempotent: every write checks current state before mutating. The
 * queue's jobId dedup also collapses duplicate POSTs from Resend's
 * retry behavior.
 *
 * Cached counter increments: Phase 3 M1 pushback #4 — we update
 * `cachedComplaintRate30d` / `cachedBounceRate30d` /
 * `cachedSendCount30d` on the TenantSendingPolicy here so the
 * dispatch barrier reads cached values, never raw aggregates.
 */
export async function handleResendWebhook(job: Job): Promise<void> {
  const { eventType, messageId, payload } = resendWebhookPayloadSchema.parse(
    job.data,
  );

  // Phase 9 — inbound events (customer reply → Resend inbound → us).
  // Persist the raw payload as an InboundEmail row and enqueue the
  // inbound-emails routing worker which handles token decode + fan-
  // out to campaign / agent / automation reply hooks.
  //
  // Resend's inbound event name at the time of writing is one of
  // `email.inbound` or `email.received` depending on account tier —
  // handle both defensively.
  if (
    eventType === 'email.inbound' ||
    eventType === 'email.received' ||
    eventType === 'email.inbound.received'
  ) {
    await handleInboundEvent(messageId, payload);
    return;
  }

  // Resolve the send by messageId. Resend's globally-unique id is
  // `(tenantId, messageId)` indexed on CampaignSend.
  const send = await prisma.campaignSend.findFirst({
    where: { messageId },
    select: {
      id: true,
      tenantId: true,
      campaignId: true,
      contactId: true,
      contact: { select: { id: true, email: true, emailStatus: true } },
      status: true,
    },
  });
  if (!send) {
    // Could be a transactional / test email not tied to a campaign,
    // or a stale event for a deleted send. Drop quietly — failing the
    // job would just retry forever.
    console.info(
      `[webhook:resend] no CampaignSend matched messageId=${messageId} (event=${eventType}); skipping`,
    );
    return;
  }

  const data = (payload.data ?? {}) as Record<string, unknown>;

  switch (eventType) {
    case 'email.delivered':
      await markDelivered(send, data);
      break;
    case 'email.bounced':
      await markBounced(send, data);
      break;
    case 'email.complained':
      await markComplained(send, data);
      break;
    // Resend also sends email.opened / email.clicked but our pixel +
    // redirector are the canonical sources for those — Resend's
    // estimates are coarser. Drop them to avoid double-counting.
    case 'email.opened':
    case 'email.clicked':
    case 'email.sent':
      // No-op; we already wrote SENT inline at dispatch time.
      break;
    default:
      console.info(
        `[webhook:resend] unhandled eventType=${eventType} for send ${send.id}`,
      );
  }
}

async function markDelivered(
  send: { id: string; tenantId: string; campaignId: string; status: string },
  _data: Record<string, unknown>,
): Promise<void> {
  // Promote SENT → DELIVERED. Don't downgrade OPENED / CLICKED.
  if (send.status === CampaignSendStatus.SENT) {
    await withTenant(send.tenantId, async (tx) => {
      await tx.campaignSend.update({
        where: { id: send.id },
        data: {
          status: CampaignSendStatus.DELIVERED,
          lastEventAt: new Date(),
        },
      });
      await tx.campaignEvent.create({
        data: {
          tenantId: send.tenantId,
          campaignSendId: send.id,
          campaignId: send.campaignId,
          type: CampaignEventType.DELIVERED,
          occurredAt: new Date(),
        },
      });
    });
  }
}

async function markBounced(
  send: {
    id: string;
    tenantId: string;
    campaignId: string;
    contactId: string;
    contact: { id: string; email: string | null } | null;
    status: string;
  },
  data: Record<string, unknown>,
): Promise<void> {
  const bounceCode = String(data.bounceCode ?? data.bounce_code ?? '');
  const bounceReason = String(data.bounceReason ?? data.bounce_reason ?? '');
  const isHardBounce =
    /^5\./.test(bounceCode) || /permanent/i.test(bounceReason);

  await withTenant(send.tenantId, async (tx) => {
    await tx.campaignSend.update({
      where: { id: send.id },
      data: {
        status: CampaignSendStatus.BOUNCED,
        lastEventAt: new Date(),
        errorMessage: bounceReason.slice(0, 500) || 'Bounced',
      },
    });
    await tx.campaignEvent.create({
      data: {
        tenantId: send.tenantId,
        campaignSendId: send.id,
        campaignId: send.campaignId,
        type: CampaignEventType.BOUNCED,
        metadata: { bounceCode, bounceReason },
        occurredAt: new Date(),
      },
    });

    // Hard bounce → flip the contact's emailStatus + auto-suppress.
    // Soft bounce → just record the event; contact stays SUBSCRIBED.
    if (isHardBounce && send.contact?.email) {
      await tx.contact.update({
        where: { id: send.contact.id },
        data: { emailStatus: ContactChannelStatus.BOUNCED },
      });
      await upsertSuppressionEntry(tx, {
        tenantId: send.tenantId,
        channel: Channel.EMAIL,
        value: send.contact.email,
        reason: SuppressionReason.BOUNCED,
        metadata: { bounceCode, bounceReason },
      });
      await emitContactEvent(tx, {
        tenantId: send.tenantId,
        contactId: send.contact.id,
        type: ContactEventType.BOUNCED,
        metadata: {
          channel: 'EMAIL',
          campaignId: send.campaignId,
          bounceCode,
          bounceReason,
        },
      });
    }
  });

  // Cached counter update for the suspension decision. Increment
  // bounce count + recompute rate from the existing send count.
  await bumpCachedRate(send.tenantId, 'bounce');
}

async function markComplained(
  send: {
    id: string;
    tenantId: string;
    campaignId: string;
    contactId: string;
    contact: { id: string; email: string | null } | null;
    status: string;
  },
  data: Record<string, unknown>,
): Promise<void> {
  const complaintType = String(data.complaintType ?? data.complaint_type ?? '');

  await withTenant(send.tenantId, async (tx) => {
    await tx.campaignSend.update({
      where: { id: send.id },
      data: {
        status: CampaignSendStatus.COMPLAINED,
        lastEventAt: new Date(),
      },
    });
    await tx.campaignEvent.create({
      data: {
        tenantId: send.tenantId,
        campaignSendId: send.id,
        campaignId: send.campaignId,
        type: CampaignEventType.COMPLAINED,
        metadata: { complaintType },
        occurredAt: new Date(),
      },
    });
    if (send.contact?.email) {
      await tx.contact.update({
        where: { id: send.contact.id },
        data: { emailStatus: ContactChannelStatus.COMPLAINED },
      });
      await upsertSuppressionEntry(tx, {
        tenantId: send.tenantId,
        channel: Channel.EMAIL,
        value: send.contact.email,
        reason: SuppressionReason.COMPLAINED,
        metadata: { complaintType },
      });
      await emitContactEvent(tx, {
        tenantId: send.tenantId,
        contactId: send.contact.id,
        type: ContactEventType.COMPLAINED,
        metadata: {
          channel: 'EMAIL',
          campaignId: send.campaignId,
          complaintType,
        },
      });
    }
  });

  await bumpCachedRate(send.tenantId, 'complaint');
}

/**
 * Increment the cached rate counter on TenantSendingPolicy. We compute
 * the new rate from `cachedSendCount30d` (the denominator), which is
 * already kept current by incrementSendCounters in the dispatch handler.
 *
 * The hourly drift-correct cron (cron.ts) recomputes from raw events
 * to fix any precision loss from these incremental updates.
 */
async function bumpCachedRate(
  tenantId: string,
  kind: 'bounce' | 'complaint',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const policy = await tx.tenantSendingPolicy.findUnique({
      where: { tenantId },
    });
    if (!policy) return;
    if (policy.cachedSendCount30d <= 0) return;

    // Clamp helper. cachedSendCount30d only updates from the hourly
    // drift-correct cron, but bounces/complaints increment per-event.
    // Between cron runs the denominator can be hours-stale: if 10k
    // emails blast out and 1k bounce while the cached count is still
    // 10 (from before the blast), each bounce gives newCount/10 — and
    // rates like 100.0 (= 10000%) end up in suspension messages.
    //
    // Clamping to [0, 1] keeps the suspension decision honest (any
    // rate above the threshold still trips it) while making the
    // surfaced number physically meaningful. The drift-correct cron
    // restores the precise rate within the hour.
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

    if (kind === 'bounce') {
      const newCount =
        Math.round(policy.cachedBounceRate30d * policy.cachedSendCount30d) + 1;
      await tx.tenantSendingPolicy.update({
        where: { tenantId },
        data: {
          cachedBounceRate30d: clamp01(newCount / policy.cachedSendCount30d),
          cachedRatesUpdatedAt: new Date(),
        },
      });
    } else {
      const newCount =
        Math.round(
          policy.cachedComplaintRate30d * policy.cachedSendCount30d,
        ) + 1;
      await tx.tenantSendingPolicy.update({
        where: { tenantId },
        data: {
          cachedComplaintRate30d: clamp01(newCount / policy.cachedSendCount30d),
          cachedRatesUpdatedAt: new Date(),
        },
      });
    }
  });
}

// -----------------------------------------------------------------
// Phase 9 — Resend inbound event handler
// -----------------------------------------------------------------

/**
 * Persist an inbound email + hand off to the inbound-emails routing
 * worker (which already exists for Phase 8 M1c). Kept intentionally
 * dumb: extract fields defensively, insert row, enqueue. The routing
 * worker owns token decode + fan-out.
 *
 * Resend's inbound event `data` shape (fields we care about):
 *   { id, from, to[], subject, text, html, headers, in_reply_to?, references? }
 *
 * We defensively coerce because Resend has changed field names in
 * beta and different tiers report subtly different shapes.
 */
async function handleInboundEvent(
  messageId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const data = ((payload.data ?? {}) as Record<string, unknown>) || {};

  // `from` may be a string or an object like { address, name }.
  const fromRaw = data.from as unknown;
  let fromAddress = '';
  let fromName: string | null = null;
  if (typeof fromRaw === 'string') {
    fromAddress = fromRaw;
  } else if (fromRaw && typeof fromRaw === 'object') {
    fromAddress = String(
      (fromRaw as { address?: unknown; email?: unknown }).address ??
        (fromRaw as { email?: unknown }).email ??
        '',
    );
    fromName =
      String((fromRaw as { name?: unknown }).name ?? '') || null;
  }

  // `to` may be a comma-separated string or a string[] or [{address}].
  // We want the one that has our `reply+<token>@` local part.
  const toCandidates = Array.isArray(data.to)
    ? (data.to as unknown[]).map((t) =>
        typeof t === 'string'
          ? t
          : String((t as { address?: unknown })?.address ?? ''),
      )
    : typeof data.to === 'string'
      ? String(data.to).split(',').map((s) => s.trim())
      : [];
  const toAddress =
    toCandidates.find((t) => /reply\+/i.test(t)) || toCandidates[0] || '';

  const subject = String(data.subject ?? '(no subject)');
  const bodyText = String(data.text ?? '');
  const bodyHtml = String(data.html ?? '');
  const inReplyTo = data.in_reply_to
    ? String(data.in_reply_to)
    : (data.headers as { 'in-reply-to'?: string } | undefined)?.['in-reply-to']
      ?? null;
  const referencesHeader = Array.isArray(data.references)
    ? (data.references as unknown[]).map(String)
    : [];

  if (!fromAddress || !toAddress) {
    console.warn(
      `[webhook:resend:inbound] missing from/to on payload id=${messageId}; skipping`,
    );
    return;
  }

  // Idempotent on messageId — Resend retries on non-2xx.
  const existing = messageId
    ? await prisma.inboundEmail.findUnique({ where: { messageId } })
    : null;
  if (existing) {
    console.info(
      `[webhook:resend:inbound] duplicate inbound messageId=${messageId}; skipping`,
    );
    return;
  }

  const row = await prisma.inboundEmail.create({
    data: {
      messageId: messageId || null,
      fromAddress: fromAddress.toLowerCase(),
      fromName,
      toAddress: toAddress.toLowerCase(),
      subject,
      bodyHtml,
      bodyText,
      inReplyTo,
      referencesHeader,
      rawPayload: payload as unknown as object,
    },
    select: { id: true },
  });

  console.info(
    `[webhook:resend:inbound] persisted InboundEmail=${row.id} from=${fromAddress} to=${toAddress}`,
  );

  // Hand off to the routing worker.
  try {
    const { Queue } = await import('bullmq');
    const { createRedisConnection } = await import('../redis');
    const { QUEUE_NAMES, JOB_NAMES } = await import('@getyn/types');
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL missing');
    const connection = createRedisConnection(url);
    const q = new Queue(QUEUE_NAMES.inboundEmails, { connection });
    await q.add(
      JOB_NAMES.inboundEmails.process,
      { inboundEmailId: row.id },
      { jobId: `inbound_${row.id}` },
    );
  } catch (err) {
    console.error(
      `[webhook:resend:inbound] failed to enqueue routing for ${row.id}`,
      err,
    );
  }
}
