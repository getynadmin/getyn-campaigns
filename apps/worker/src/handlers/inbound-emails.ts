/* eslint-disable no-console */
/**
 * Phase 8 M1 — inbound reply router.
 *
 * Loads the persisted InboundEmail row, extracts the +token from the
 * To: address, HMAC-verifies it, then fans out based on the token
 * kind:
 *
 *   'c' → CampaignSend: emit CampaignEvent(REPLIED), ContactEvent
 *         (EMAIL_REPLIED), flip CampaignSend.status to REPLIED.
 *   'a' → EmailAgentEnrollment: enqueue email-agent-process-reply
 *         (stubbed for now — M5 wires the actual handler).
 *   'w' → AutomationEnrollment: apply automation.settings.onReply
 *         policy (default STOP).
 *
 * Any decode failure / missing target / mismatched tenant → row is
 * marked UNMATCHED with processError set. It surfaces in the Inbox
 * UI so operators can eyeball what's flowing in.
 */
import { CampaignEventType, CampaignSendStatus, ContactEventType, InboundEmailMatch, prisma } from '@getyn/db';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';

import {
  decodeReplyToken,
  extractTokenFromAddress,
} from '@getyn/crypto';
import { type InboundEmailProcessPayload } from '@getyn/types';

export async function handleInboundEmailProcess(
  job: Job<InboundEmailProcessPayload>,
): Promise<void> {
  const { inboundEmailId } = job.data;

  const row = await prisma.inboundEmail.findUnique({
    where: { id: inboundEmailId },
    select: {
      id: true,
      toAddress: true,
      fromAddress: true,
      matchedTo: true,
      processedAt: true,
    },
  });
  if (!row) {
    console.warn(`[inbound-email] row ${inboundEmailId} not found — dropping job`);
    return;
  }
  // Idempotence: if a prior worker attempt succeeded, don't re-route.
  if (row.processedAt && row.matchedTo !== InboundEmailMatch.UNMATCHED) {
    return;
  }

  const secret = process.env.REPLY_ROUTING_SECRET;
  if (!secret) {
    await failRow(inboundEmailId, 'missing_secret');
    Sentry.captureMessage('[inbound-email] REPLY_ROUTING_SECRET unset', {
      level: 'error',
    });
    return;
  }

  const rawToken = extractTokenFromAddress(row.toAddress);
  if (!rawToken) {
    await failRow(inboundEmailId, 'no_token_in_to');
    return;
  }
  const decoded = decodeReplyToken(rawToken, secret);
  if (!decoded.ok) {
    await failRow(inboundEmailId, `decode_${decoded.reason}`);
    return;
  }

  const { kind, payload } = decoded.token;

  try {
    if (kind === 'c') {
      await routeCampaignReply(inboundEmailId, payload.id, payload.tenantId);
    } else if (kind === 'a') {
      await routeAgentReply(inboundEmailId, payload.id, payload.tenantId);
    } else if (kind === 'w') {
      await routeAutomationReply(
        inboundEmailId,
        payload.id,
        payload.tenantId,
        payload.nodeId ?? null,
      );
    }
  } catch (err) {
    console.error(`[inbound-email] routing failed for ${inboundEmailId}`, err);
    Sentry.captureException(err, {
      tags: { handler: 'inbound-email', kind },
      extra: { inboundEmailId, payload },
    });
    await failRow(inboundEmailId, `route_failed: ${(err as Error).message ?? 'unknown'}`);
  }
}

async function failRow(id: string, error: string): Promise<void> {
  await prisma.inboundEmail.update({
    where: { id },
    data: {
      matchedTo: InboundEmailMatch.UNMATCHED,
      processError: error,
      processedAt: new Date(),
    },
  });
}

// -----------------------------------------------------------------
// Campaign reply — MVP: mark it replied + emit events.
// -----------------------------------------------------------------

async function routeCampaignReply(
  inboundEmailId: string,
  campaignSendId: string,
  claimedTenantId: string,
): Promise<void> {
  const send = await prisma.campaignSend.findUnique({
    where: { id: campaignSendId },
    select: {
      id: true,
      tenantId: true,
      campaignId: true,
      contactId: true,
      status: true,
    },
  });
  if (!send) {
    await failRow(inboundEmailId, 'campaign_send_not_found');
    return;
  }
  if (send.tenantId !== claimedTenantId) {
    // HMAC-signed tokens should make this impossible; log loudly if
    // it ever fires — someone has the signing secret they shouldn't.
    Sentry.captureMessage('[inbound-email] tenant mismatch on campaign reply', {
      level: 'error',
      extra: { inboundEmailId, campaignSendId, claimedTenantId, actual: send.tenantId },
    });
    await failRow(inboundEmailId, 'tenant_mismatch');
    return;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.inboundEmail.update({
      where: { id: inboundEmailId },
      data: {
        tenantId: send.tenantId,
        matchedTo: InboundEmailMatch.CAMPAIGN_SEND,
        campaignSendId: send.id,
        processedAt: now,
      },
    }),
    // Only flip status if it hasn't already progressed past SENT.
    prisma.campaignSend.updateMany({
      where: {
        id: send.id,
        status: { in: [CampaignSendStatus.SENT, CampaignSendStatus.DELIVERED, CampaignSendStatus.OPENED, CampaignSendStatus.CLICKED] },
      },
      data: { status: CampaignSendStatus.REPLIED, lastEventAt: now },
    }),
    prisma.campaignEvent.create({
      data: {
        tenantId: send.tenantId,
        campaignId: send.campaignId,
        campaignSendId: send.id,
        type: CampaignEventType.REPLIED,
        occurredAt: now,
        metadata: { contactId: send.contactId },
      },
    }),
    prisma.contactEvent.create({
      data: {
        tenantId: send.tenantId,
        contactId: send.contactId,
        type: ContactEventType.EMAIL_REPLIED,
        occurredAt: now,
        metadata: { campaignId: send.campaignId, campaignSendId: send.id },
      },
    }),
  ]);
}

// -----------------------------------------------------------------
// Agent reply — stubbed. M5 wires the actual handler that classifies
// with Haiku + drafts with Sonnet.
// -----------------------------------------------------------------

async function routeAgentReply(
  inboundEmailId: string,
  enrollmentId: string,
  claimedTenantId: string,
): Promise<void> {
  const enrollment = await prisma.emailAgentEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, tenantId: true },
  });
  if (!enrollment) {
    await failRow(inboundEmailId, 'agent_enrollment_not_found');
    return;
  }
  if (enrollment.tenantId !== claimedTenantId) {
    Sentry.captureMessage('[inbound-email] tenant mismatch on agent reply', {
      level: 'error',
      extra: { inboundEmailId, enrollmentId, claimedTenantId, actual: enrollment.tenantId },
    });
    await failRow(inboundEmailId, 'tenant_mismatch');
    return;
  }

  // Stamp the enrollment so M5's follow-up tick can see a reply came in.
  const now = new Date();
  await prisma.$transaction([
    prisma.inboundEmail.update({
      where: { id: inboundEmailId },
      data: {
        tenantId: enrollment.tenantId,
        matchedTo: InboundEmailMatch.AGENT_ENROLLMENT,
        emailAgentEnrollmentId: enrollment.id,
        processedAt: now,
      },
    }),
    prisma.emailAgentEnrollment.update({
      where: { id: enrollment.id },
      data: { lastInboundAt: now },
    }),
  ]);

  // M5 handoff: enqueue email-agent-process-reply so Haiku classifies
  // and Sonnet drafts. Fire-and-forget — a Redis blip shouldn't
  // reject the inbound webhook.
  try {
    const { enqueueEmailAgentProcessReply } = await getEmailAgentProducer();
    await enqueueEmailAgentProcessReply(inboundEmailId, enrollment.id, enrollment.tenantId);
  } catch (err) {
    console.error('[inbound-email] agent-reply enqueue failed', err);
    Sentry.captureException(err, {
      tags: { handler: 'inbound-email', failure: 'enqueue-agent-reply' },
      extra: { inboundEmailId, enrollmentId: enrollment.id },
    });
  }
}

// Lazy queue producer — same pattern as apps/worker/src/handlers/automation.ts.
let cachedEmailAgentProducer: {
  enqueueEmailAgentProcessReply: (
    inboundEmailId: string,
    enrollmentId: string,
    tenantId: string,
  ) => Promise<void>;
} | null = null;

async function getEmailAgentProducer(): Promise<NonNullable<typeof cachedEmailAgentProducer>> {
  if (cachedEmailAgentProducer) return cachedEmailAgentProducer;
  const { Queue } = await import('bullmq');
  const { createRedisConnection } = await import('../redis');
  const { QUEUE_NAMES, JOB_NAMES } = await import('@getyn/types');
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL missing');
  const connection = createRedisConnection(url);
  const q = new Queue(QUEUE_NAMES.emailAgent, { connection });
  cachedEmailAgentProducer = {
    enqueueEmailAgentProcessReply: async (inboundEmailId, enrollmentId, tenantId) => {
      await q.add(
        JOB_NAMES.emailAgent.processReply,
        { inboundEmailId, enrollmentId, tenantId },
        { jobId: `reply_${inboundEmailId}` },
      );
    },
  };
  return cachedEmailAgentProducer;
}

// -----------------------------------------------------------------
// Automation reply — apply onReply policy. Default STOP.
// -----------------------------------------------------------------

async function routeAutomationReply(
  inboundEmailId: string,
  enrollmentId: string,
  claimedTenantId: string,
  nodeId: string | null,
): Promise<void> {
  const enrollment = await prisma.automationEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      automation: { select: { settings: true } },
    },
  });
  if (!enrollment) {
    await failRow(inboundEmailId, 'automation_enrollment_not_found');
    return;
  }
  if (enrollment.tenantId !== claimedTenantId) {
    Sentry.captureMessage('[inbound-email] tenant mismatch on automation reply', {
      level: 'error',
      extra: { inboundEmailId, enrollmentId, claimedTenantId, actual: enrollment.tenantId },
    });
    await failRow(inboundEmailId, 'tenant_mismatch');
    return;
  }

  const settings = enrollment.automation.settings as { onReply?: string } | null;
  const policy = settings?.onReply ?? 'STOP';
  const now = new Date();

  const linkOnly = prisma.inboundEmail.update({
    where: { id: inboundEmailId },
    data: {
      tenantId: enrollment.tenantId,
      matchedTo: InboundEmailMatch.AUTOMATION_ENROLLMENT,
      automationEnrollmentId: enrollment.id,
      processedAt: now,
    },
  });

  if (policy === 'STOP' && enrollment.status === 'ACTIVE') {
    await prisma.$transaction([
      linkOnly,
      prisma.automationEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: 'EXITED',
          nextActionAt: null,
          completedAt: now,
          exitReason: nodeId
            ? `reply_received_at_${nodeId}`
            : 'reply_received',
        },
      }),
    ]);
  } else {
    // CONTINUE or BRANCH — for now (pre-M3) just link. M3's engine
    // will read the linked reply on its next tick.
    await linkOnly;
  }
}
