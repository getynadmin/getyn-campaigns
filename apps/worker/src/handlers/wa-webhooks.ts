/* eslint-disable no-console */
/**
 * wa-webhooks worker handler — Phase 4 M9.
 *
 * Receives one job per persisted WhatsAppWebhookEvent row. Reads the
 * row's rawPayload + dedupeKey, dispatches by eventType:
 *
 *   inbound:<type>           → ingest into conversation + WhatsAppMessage
 *   status:<status>          → update WhatsAppCampaignSend + mirror onto
 *                              WhatsAppMessage
 *   template_status:<event>  → update WhatsAppTemplate.status
 *   phone_quality_update     → update WhatsAppPhoneNumber.qualityRating
 *   account_alerts           → log + Sentry (no programmatic action yet)
 *
 * Per kickoff M8 decision: webhook is the PRIMARY signal for inbound
 * (we don't poll inbound for free-form replies because of latency)
 * and SECONDARY for outbound status (the 2-min poll is authoritative).
 *
 * Idempotency: we mark `processedAt` on the row at the end. Re-runs
 * (BullMQ retries, duplicate POSTs) check `processedAt !== null` and
 * short-circuit. The same dedupeKey UNIQUE constraint prevents
 * duplicate row insertion at the receiver.
 */
import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';

import {
  ContactEventType,
  prisma,
  WAMessageDirection,
  WAMessageType,
  WAPricingCategory,
  WASendStatus,
  WATemplateStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import {
  waWebhookProcessPayloadSchema,
  type WaWebhookProcessPayload,
} from '@getyn/types';

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function handleWaWebhookEvent(job: Job): Promise<void> {
  const payload: WaWebhookProcessPayload = waWebhookProcessPayloadSchema.parse(
    job.data,
  );
  const event = await prisma.whatsAppWebhookEvent.findUnique({
    where: { id: payload.webhookEventId },
  });
  if (!event) return;
  if (event.processedAt) return; // idempotent: already done

  try {
    if (event.eventType.startsWith('inbound:')) {
      await handleInbound(event);
    } else if (event.eventType.startsWith('status:')) {
      await handleStatus(event);
    } else if (event.eventType.startsWith('template_status:')) {
      await handleTemplateStatus(event);
    } else if (event.eventType === 'phone_quality_update') {
      await handlePhoneQuality(event);
    } else if (event.eventType === 'account_alerts') {
      await handleAccountAlert(event);
    } else {
      console.info(
        `[wa-webhooks] unknown eventType=${event.eventType} id=${event.id}; skipping`,
      );
    }
    await prisma.whatsAppWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), processError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown';
    await prisma.whatsAppWebhookEvent.update({
      where: { id: event.id },
      data: { processError: message.slice(0, 1000) },
    });
    Sentry.captureException(err, {
      tags: {
        queue: 'wa-webhooks',
        eventType: event.eventType,
        failure: 'process',
      },
      extra: { webhookEventId: event.id, dedupeKey: event.dedupeKey },
    });
    throw err; // BullMQ retries up to 5x with backoff
  }
}

// ----------------------------------------------------------------------------
// Branches
// ----------------------------------------------------------------------------

interface MetaPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<MetaInbound>;
        statuses?: Array<MetaStatus>;
        message_template_id?: string;
        message_template_name?: string;
        event?: string;
        reason?: string;
      };
    }>;
  }>;
}

interface MetaInbound {
  id: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  context?: { id?: string }; // reply-to message id
  image?: { id?: string; mime_type?: string; caption?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: {
    id?: string;
    mime_type?: string;
    caption?: string;
    filename?: string;
  };
  audio?: { id?: string; mime_type?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown;
  interactive?: { type?: string; button_reply?: unknown; list_reply?: unknown };
  reaction?: { message_id?: string; emoji?: string };
}

interface MetaStatus {
  id: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: { id?: string; origin?: { type?: string } };
  pricing?: { category?: string };
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

/**
 * Locate the WhatsAppPhoneNumber + tenant for a given Meta phone_number_id.
 * Returns null when the phone isn't registered locally (e.g. a tenant
 * disconnected mid-flight). Caller decides what to do; we mostly skip.
 */
async function resolvePhone(metaPhoneNumberId: string): Promise<{
  tenantId: string;
  whatsAppAccountId: string;
  phoneNumberId: string;
} | null> {
  const row = await prisma.whatsAppPhoneNumber.findFirst({
    where: { phoneNumberId: metaPhoneNumberId },
    select: { id: true, tenantId: true, whatsAppAccountId: true },
  });
  if (!row) return null;
  return {
    tenantId: row.tenantId,
    whatsAppAccountId: row.whatsAppAccountId,
    phoneNumberId: row.id,
  };
}

function findInbound(
  payload: MetaPayload,
  messageId: string,
): { msg: MetaInbound; metaPhoneId: string } | null {
  for (const e of payload.entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value ?? {};
      const metaPhoneId = v.metadata?.phone_number_id;
      if (!metaPhoneId) continue;
      const m = (v.messages ?? []).find((x) => x.id === messageId);
      if (m) return { msg: m, metaPhoneId };
    }
  }
  return null;
}

function findStatus(
  payload: MetaPayload,
  messageId: string,
  status: string,
): MetaStatus | null {
  for (const e of payload.entry ?? []) {
    for (const c of e.changes ?? []) {
      const v = c.value ?? {};
      const s = (v.statuses ?? []).find(
        (x) => x.id === messageId && x.status === status,
      );
      if (s) return s;
    }
  }
  return null;
}

function mapMessageType(t: string | undefined): WAMessageType {
  switch (t) {
    case 'text':
      return WAMessageType.TEXT;
    case 'image':
      return WAMessageType.IMAGE;
    case 'video':
      return WAMessageType.VIDEO;
    case 'document':
      return WAMessageType.DOCUMENT;
    case 'audio':
      return WAMessageType.AUDIO;
    case 'sticker':
      return WAMessageType.STICKER;
    case 'location':
      return WAMessageType.LOCATION;
    case 'contacts':
      return WAMessageType.CONTACT;
    case 'reaction':
      return WAMessageType.REACTION;
    case 'interactive':
      return WAMessageType.INTERACTIVE_BUTTON;
    default:
      return WAMessageType.UNSUPPORTED;
  }
}

function extractBodyAndMedia(msg: MetaInbound): {
  body: string | null;
  mediaMetaId: string | null;
} {
  if (msg.type === 'text') return { body: msg.text?.body ?? null, mediaMetaId: null };
  if (msg.type === 'image') return { body: msg.image?.caption ?? null, mediaMetaId: msg.image?.id ?? null };
  if (msg.type === 'video') return { body: msg.video?.caption ?? null, mediaMetaId: msg.video?.id ?? null };
  if (msg.type === 'document') return { body: msg.document?.caption ?? null, mediaMetaId: msg.document?.id ?? null };
  if (msg.type === 'audio') return { body: null, mediaMetaId: msg.audio?.id ?? null };
  if (msg.type === 'sticker') return { body: null, mediaMetaId: msg.sticker?.id ?? null };
  if (msg.type === 'location') {
    const parts = [msg.location?.name, msg.location?.address].filter(Boolean);
    return { body: parts.join(' — ') || null, mediaMetaId: null };
  }
  if (msg.type === 'reaction') return { body: msg.reaction?.emoji ?? null, mediaMetaId: null };
  return { body: null, mediaMetaId: null };
}

async function handleInbound(event: {
  id: string;
  dedupeKey: string;
  rawPayload: Prisma.JsonValue;
}): Promise<void> {
  const messageId = event.dedupeKey.slice('inbound:'.length);
  const payload = event.rawPayload as unknown as MetaPayload;
  const found = findInbound(payload, messageId);
  if (!found) return;

  const phone = await resolvePhone(found.metaPhoneId);
  if (!phone) {
    // Tenant disconnected — quietly drop. The polling fallback may
    // still surface it later if the WABA reconnects.
    console.warn(
      `[wa-webhooks:inbound] no local phone for meta=${found.metaPhoneId}; skipping`,
    );
    return;
  }

  const fromPhone = found.msg.from ? `+${found.msg.from.replace(/^\+/, '')}` : null;
  if (!fromPhone) return;

  const { body, mediaMetaId } = extractBodyAndMedia(found.msg);
  const messageType = mapMessageType(found.msg.type);
  const tsSec = found.msg.timestamp ? Number.parseInt(found.msg.timestamp, 10) : null;
  const sentAt = tsSec && Number.isFinite(tsSec) ? new Date(tsSec * 1000) : new Date();

  await withTenant(phone.tenantId, async (tx) => {
    // Find or create the conversation.
    const conv = await tx.whatsAppConversation.upsert({
      where: {
        tenantId_phoneNumberId_contactPhone: {
          tenantId: phone.tenantId,
          phoneNumberId: phone.phoneNumberId,
          contactPhone: fromPhone,
        },
      },
      create: {
        tenantId: phone.tenantId,
        whatsAppAccountId: phone.whatsAppAccountId,
        phoneNumberId: phone.phoneNumberId,
        contactPhone: fromPhone,
        lastInboundAt: sentAt,
        lastMessageAt: sentAt,
        lastMessagePreview: previewOf(body, messageType),
        // Service window opens for 24h on every INBOUND. Outbound
        // replies do NOT extend it — Meta's actual rule.
        serviceWindowExpiresAt: new Date(sentAt.getTime() + SERVICE_WINDOW_MS),
        unreadCount: 1,
      },
      update: {
        lastInboundAt: sentAt,
        lastMessageAt: sentAt,
        lastMessagePreview: previewOf(body, messageType),
        serviceWindowExpiresAt: new Date(sentAt.getTime() + SERVICE_WINDOW_MS),
        // Atomic increment via raw SQL would be ideal; using update's
        // increment helper keeps it simple + correct.
        unreadCount: { increment: 1 },
      },
    });

    // Try to attach to an existing contact by phone. If unmatched,
    // we leave contactId null — M10's UI surfaces a "Convert to
    // contact" CTA. We don't auto-create contacts: a stranger's
    // first ping shouldn't pollute the contact list silently.
    if (!conv.contactId) {
      const contact = await tx.contact.findFirst({
        where: { tenantId: phone.tenantId, phone: fromPhone },
        select: { id: true },
      });
      if (contact) {
        await tx.whatsAppConversation.update({
          where: { id: conv.id },
          data: { contactId: contact.id },
        });
      }
    }

    // Dedupe per metaMessageId — webhooks can deliver twice.
    const existing = await tx.whatsAppMessage.findFirst({
      where: { tenantId: phone.tenantId, metaMessageId: messageId },
      select: { id: true },
    });
    if (existing) return;

    await tx.whatsAppMessage.create({
      data: {
        tenantId: phone.tenantId,
        conversationId: conv.id,
        direction: WAMessageDirection.INBOUND,
        metaMessageId: messageId,
        type: messageType,
        body,
        mediaMetaId,
        replyToMessageId: found.msg.context?.id ?? null,
        sentAt,
        status: WASendStatus.DELIVERED, // inbound = already delivered to us
        deliveredAt: sentAt,
        metadata: {
          raw: found.msg as unknown,
        } as Prisma.JsonObject,
      },
    });

    // Emit a contact event so the timeline picks it up. Skipped
    // when we couldn't link to a Contact (no phantom timeline rows).
    if (conv.contactId) {
      await tx.contactEvent.create({
        data: {
          tenantId: phone.tenantId,
          contactId: conv.contactId,
          type: ContactEventType.WHATSAPP_REPLIED,
          metadata: { metaMessageId: messageId } as Prisma.JsonObject,
        },
      });
    }
  });
}

function previewOf(body: string | null, type: WAMessageType): string {
  if (body) return body.slice(0, 120);
  if (type === WAMessageType.IMAGE) return '📷 Image';
  if (type === WAMessageType.VIDEO) return '🎥 Video';
  if (type === WAMessageType.DOCUMENT) return '📎 Document';
  if (type === WAMessageType.AUDIO) return '🎤 Audio';
  if (type === WAMessageType.STICKER) return '🟡 Sticker';
  if (type === WAMessageType.LOCATION) return '📍 Location';
  if (type === WAMessageType.REACTION) return 'Reaction';
  if (type === WAMessageType.UNSUPPORTED) return 'Unsupported message';
  return '';
}

async function handleStatus(event: {
  id: string;
  dedupeKey: string;
  rawPayload: Prisma.JsonValue;
}): Promise<void> {
  // dedupeKey = "status:<messageId>:<status>"
  const parts = event.dedupeKey.split(':');
  if (parts.length < 3) return;
  const messageId = parts[1];
  const status = parts.slice(2).join(':');
  if (!messageId) return;

  const payload = event.rawPayload as unknown as MetaPayload;
  const meta = findStatus(payload, messageId, status);
  if (!meta) return;

  const tsSec = meta.timestamp ? Number.parseInt(meta.timestamp, 10) : null;
  const at = tsSec && Number.isFinite(tsSec) ? new Date(tsSec * 1000) : new Date();

  // Look up the campaign send by metaMessageId — single global
  // index is enough; tenant scoping via the row's tenantId.
  const send = await prisma.whatsAppCampaignSend.findFirst({
    where: { metaMessageId: messageId },
  });
  if (!send) {
    // Free-form reply / unknown sender: try the message table directly.
    const msg = await prisma.whatsAppMessage.findFirst({
      where: { metaMessageId: messageId },
      select: { id: true, tenantId: true },
    });
    if (msg) {
      await applyStatusToMessage(msg.tenantId, msg.id, status, at, meta);
    }
    return;
  }

  await withTenant(send.tenantId, async (tx) => {
    const newStatus = mapToWaSendStatus(status, send.status);
    if (!newStatus) return;
    await tx.whatsAppCampaignSend.update({
      where: { id: send.id },
      data: {
        status: newStatus,
        ...(status === 'delivered' ? { deliveredAt: at } : {}),
        ...(status === 'read' ? { readAt: at } : {}),
        ...(status === 'failed'
          ? {
              errorCode: meta.errors?.[0]?.code
                ? String(meta.errors[0].code)
                : null,
              errorMessage:
                (meta.errors?.[0]?.message ?? meta.errors?.[0]?.title ?? null)?.slice(0, 500) ?? null,
            }
          : {}),
        ...(meta.pricing?.category
          ? { pricingCategory: mapPricingCategory(meta.pricing.category) }
          : {}),
        conversationId: meta.conversation?.id ?? send.conversationId,
        lastEventAt: at,
      },
    });
    // Mirror onto the inbox WhatsAppMessage row.
    await tx.whatsAppMessage.updateMany({
      where: { tenantId: send.tenantId, metaMessageId: messageId },
      data: {
        status: newStatus,
        ...(status === 'delivered' ? { deliveredAt: at } : {}),
        ...(status === 'read' ? { readAt: at } : {}),
      },
    });
    if (status === 'delivered') {
      await tx.contactEvent.create({
        data: {
          tenantId: send.tenantId,
          contactId: send.contactId,
          type: ContactEventType.WHATSAPP_DELIVERED,
          metadata: { campaignId: send.campaignId } as Prisma.JsonObject,
        },
      });
    } else if (status === 'read') {
      await tx.contactEvent.create({
        data: {
          tenantId: send.tenantId,
          contactId: send.contactId,
          type: ContactEventType.WHATSAPP_READ,
          metadata: { campaignId: send.campaignId } as Prisma.JsonObject,
        },
      });
    } else if (status === 'failed') {
      await tx.contactEvent.create({
        data: {
          tenantId: send.tenantId,
          contactId: send.contactId,
          type: ContactEventType.WHATSAPP_FAILED,
          metadata: { campaignId: send.campaignId } as Prisma.JsonObject,
        },
      });
    }
  });
}

async function applyStatusToMessage(
  tenantId: string,
  messageRowId: string,
  status: string,
  at: Date,
  meta: MetaStatus,
): Promise<void> {
  const newStatus = mapToWaSendStatus(status, WASendStatus.SENT);
  if (!newStatus) return;
  await withTenant(tenantId, (tx) =>
    tx.whatsAppMessage.update({
      where: { id: messageRowId },
      data: {
        status: newStatus,
        ...(status === 'delivered' ? { deliveredAt: at } : {}),
        ...(status === 'read' ? { readAt: at } : {}),
        ...(status === 'failed'
          ? {
              failedAt: at,
              errorCode: meta.errors?.[0]?.code
                ? String(meta.errors[0].code)
                : null,
              errorMessage:
                (meta.errors?.[0]?.message ?? meta.errors?.[0]?.title ?? null)?.slice(0, 500) ?? null,
            }
          : {}),
      },
    }),
  );
}

function mapToWaSendStatus(
  metaStatus: string,
  current: WASendStatus,
): WASendStatus | null {
  if (metaStatus === 'sent' && current === WASendStatus.QUEUED) return WASendStatus.SENT;
  if (metaStatus === 'delivered' && current !== WASendStatus.READ) return WASendStatus.DELIVERED;
  if (metaStatus === 'read') return WASendStatus.READ;
  if (metaStatus === 'failed') return WASendStatus.FAILED;
  return null;
}

function mapPricingCategory(c: string): WAPricingCategory {
  switch (c.toUpperCase()) {
    case 'AUTHENTICATION':
      return WAPricingCategory.AUTHENTICATION;
    case 'MARKETING':
      return WAPricingCategory.MARKETING;
    case 'UTILITY':
      return WAPricingCategory.UTILITY;
    case 'SERVICE':
      return WAPricingCategory.SERVICE;
    default:
      return WAPricingCategory.SERVICE;
  }
}

async function handleTemplateStatus(event: {
  id: string;
  dedupeKey: string;
  rawPayload: Prisma.JsonValue;
}): Promise<void> {
  // dedupeKey = "template_status:<templateId>:<event>"
  const parts = event.dedupeKey.split(':');
  if (parts.length < 3) return;
  const metaTemplateId = parts[1];
  if (!metaTemplateId) return;
  const payload = event.rawPayload as unknown as MetaPayload;
  let newEvent: string | null = null;
  let reason: string | null = null;
  for (const e of payload.entry ?? []) {
    for (const c of e.changes ?? []) {
      if (
        c.field === 'message_template_status_update' &&
        c.value?.message_template_id === metaTemplateId
      ) {
        newEvent = c.value.event ?? null;
        reason = c.value.reason ?? null;
      }
    }
  }
  if (!newEvent) return;

  const tpl = await prisma.whatsAppTemplate.findFirst({
    where: { metaTemplateId },
  });
  if (!tpl) return;

  const status = mapTemplateEvent(newEvent, tpl.status);
  if (!status && !reason) return;

  await withTenant(tpl.tenantId, (tx) =>
    tx.whatsAppTemplate.update({
      where: { id: tpl.id },
      data: {
        ...(status ? { status } : {}),
        ...(reason ? { rejectionReason: reason } : {}),
        lastSyncedAt: new Date(),
        ...(status === WATemplateStatus.APPROVED && !tpl.approvedAt
          ? { approvedAt: new Date() }
          : {}),
      },
    }),
  );
}

function mapTemplateEvent(
  event: string,
  current: WATemplateStatus,
): WATemplateStatus | null {
  switch (event.toUpperCase()) {
    case 'APPROVED':
      return WATemplateStatus.APPROVED;
    case 'REJECTED':
      return WATemplateStatus.REJECTED;
    case 'PAUSED':
      return WATemplateStatus.PAUSED;
    case 'DISABLED':
    case 'PENDING_DELETION':
      return WATemplateStatus.DISABLED;
    case 'IN_APPEAL':
    case 'PENDING':
      return WATemplateStatus.PENDING;
    default:
      return current;
  }
}

async function handlePhoneQuality(event: {
  id: string;
  dedupeKey: string;
  rawPayload: Prisma.JsonValue;
}): Promise<void> {
  // Lazy: trigger a refresh of the phone via the existing
  // wa-phone-refresh routine. The webhook payload's quality fields
  // are sometimes terse; the refresh pulls authoritative values.
  // We don't enqueue here to avoid coupling — just log; the 6h
  // wa-phone-refresh tick will pick it up.
  console.info(
    `[wa-webhooks:phone_quality] event ${event.id} — refresh on next tick`,
  );
}

async function handleAccountAlert(event: {
  id: string;
  dedupeKey: string;
  rawPayload: Prisma.JsonValue;
}): Promise<void> {
  Sentry.captureMessage('wa account_alerts', {
    level: 'warning',
    tags: { queue: 'wa-webhooks', event: 'account_alerts' },
    extra: { dedupeKey: event.dedupeKey },
  });
}
