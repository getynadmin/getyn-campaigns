/* eslint-disable no-console */
import type { Job } from 'bullmq';

import {
  CampaignEventType,
  CampaignSendStatus,
  Channel,
  ContactEventType,
  SubscriptionStatus,
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
        data: { emailStatus: SubscriptionStatus.BOUNCED },
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
        data: { emailStatus: SubscriptionStatus.COMPLAINED },
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

    if (kind === 'bounce') {
      const newCount =
        Math.round(policy.cachedBounceRate30d * policy.cachedSendCount30d) + 1;
      await tx.tenantSendingPolicy.update({
        where: { tenantId },
        data: {
          cachedBounceRate30d: newCount / policy.cachedSendCount30d,
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
          cachedComplaintRate30d: newCount / policy.cachedSendCount30d,
          cachedRatesUpdatedAt: new Date(),
        },
      });
    }
  });
}
