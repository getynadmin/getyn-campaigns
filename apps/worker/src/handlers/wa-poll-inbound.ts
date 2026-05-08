/* eslint-disable no-console */
/**
 * wa-poll-inbound — gap-filler for inbound webhook delivery.
 *
 * Phase 4 M9. The webhook is the PRIMARY signal for inbound (we
 * don't want to wait 5 min for a tenant's reply to show up in the
 * inbox), but webhooks fail. Meta publishes inconsistencies, our
 * receiver could be down for a deploy, etc.
 *
 * This poll runs every 5 minutes per CONNECTED WABA. For now its
 * sole job is to DETECT silence — if we haven't received an inbound
 * webhook for >15 min on a WABA that has active conversations, log
 * + Sentry. Active recovery (replaying missed messages from Meta's
 * Graph API) is harder because Meta doesn't offer a reliable
 * "messages I sent you" cursor — that's a Phase 4.5 enhancement.
 *
 * Two job shapes:
 *   tick (every 5 min): finds CONNECTED WABAs and fans out.
 *   poll-waba: per WABA, checks recent inbound activity vs.
 *     conversation activity, surfaces silence as a Sentry warning.
 */
import * as Sentry from '@sentry/node';
import { Queue, type Job } from 'bullmq';

import { prisma, WAStatus } from '@getyn/db';
import { QUEUE_NAMES } from '@getyn/types';

import { loadEnv } from '../env';
import { createRedisConnection } from '../redis';

const env = loadEnv();

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (_queue) return _queue;
  if (!env.REDIS_URL) throw new Error('REDIS_URL unset in worker');
  _queue = new Queue(QUEUE_NAMES.waPollInbound, {
    connection: createRedisConnection(env.REDIS_URL),
  });
  return _queue;
}

const SILENCE_THRESHOLD_MS = 15 * 60 * 1000;

interface PollPayload {
  whatsAppAccountId: string;
  tenantId: string;
}

export async function handleWaPollInboundTick(): Promise<{
  enqueued: number;
}> {
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { status: WAStatus.CONNECTED },
    select: { id: true, tenantId: true },
  });
  const queue = getQueue();
  for (const a of accounts) {
    const payload: PollPayload = {
      whatsAppAccountId: a.id,
      tenantId: a.tenantId,
    };
    await queue.add('poll-waba', payload, {
      jobId: `poll-inbound_${a.id}`,
      removeOnComplete: 50,
      removeOnFail: 50,
      attempts: 1,
    });
  }
  console.info(
    `[cron:wa-poll-inbound] enqueued ${accounts.length} WABA polls`,
  );
  return { enqueued: accounts.length };
}

export async function handleWaPollInboundOne(job: Job): Promise<void> {
  const payload = job.data as PollPayload;
  if (!payload.whatsAppAccountId || !payload.tenantId) return;

  // "Active" conversation: lastMessageAt within last 24h (we'd
  // expect ongoing replies). Silence: if any active conversation's
  // lastInboundAt is older than 15 min while lastMessageAt is recent,
  // somebody's messages aren't reaching us.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const silenceCutoff = new Date(Date.now() - SILENCE_THRESHOLD_MS);

  const activeConversations = await prisma.whatsAppConversation.findMany({
    where: {
      tenantId: payload.tenantId,
      whatsAppAccountId: payload.whatsAppAccountId,
      lastMessageAt: { gte: since24h },
      // serviceWindowExpiresAt is a strong signal we're in a live
      // conversation; if it's set + in the future, we should be
      // seeing inbound regularly.
      serviceWindowExpiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      lastMessageAt: true,
    },
  });

  let silentCount = 0;
  for (const c of activeConversations) {
    // Heuristic: outbound activity within the silence window AND no
    // inbound for >15 min. The tenant is talking; the customer
    // isn't being heard. This catches 1-sided silences.
    if (
      c.lastOutboundAt &&
      c.lastOutboundAt > silenceCutoff &&
      (!c.lastInboundAt || c.lastInboundAt < silenceCutoff)
    ) {
      silentCount += 1;
    }
  }

  if (silentCount > 0) {
    Sentry.captureMessage('wa-poll-inbound: webhook silence detected', {
      level: 'warning',
      tags: {
        queue: 'wa-poll-inbound',
        tenantId: payload.tenantId,
        event: 'wa_webhook_silence',
        channel: 'whatsapp',
      },
      extra: {
        whatsAppAccountId: payload.whatsAppAccountId,
        silentConversations: silentCount,
        thresholdMinutes: SILENCE_THRESHOLD_MS / 60_000,
      },
    });
    console.warn(
      `[wa-poll-inbound] tenant=${payload.tenantId} silentConversations=${silentCount}`,
    );
  }

  // (Future: stamp a lastInboundPollAt anywhere convenient. Skipped
  // here to avoid clobbering the metadata Json blob with a partial
  // update that Prisma can't do natively.)
}
