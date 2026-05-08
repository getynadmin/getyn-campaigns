/* eslint-disable no-console */
/**
 * wa-poll-status — outbound delivery status poller (Phase 4 M8).
 *
 * Per kickoff decision: polling is the PRIMARY signal for outbound
 * campaign status (sent → delivered → read). Webhooks are accepted
 * as a faster-arriving secondary signal in M9 but we never rely on
 * them solely.
 *
 * Two job shapes:
 *
 *   tick (cron, every 2 min): finds active campaigns (sent within
 *     last 72h, with non-terminal sends) and fans out poll-campaign
 *     jobs.
 *
 *   poll-campaign: pulls Meta status for non-terminal sends in one
 *     campaign and updates DELIVERED / READ / FAILED transitions.
 */
import * as Sentry from '@sentry/node';
import { Queue, type Job } from 'bullmq';

import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  ContactEventType,
  prisma,
  WASendStatus,
  WAStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import { pollCampaignPayloadSchema } from '@getyn/types';
import { MetaApiError, getMessageStatus } from '@getyn/whatsapp';

import { loadEnv } from '../env';
import { createRedisConnection } from '../redis';

const env = loadEnv();

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (_queue) return _queue;
  if (!env.REDIS_URL) throw new Error('REDIS_URL unset in worker');
  _queue = new Queue('wa-poll-status', {
    connection: createRedisConnection(env.REDIS_URL),
  });
  return _queue;
}

const POLL_WINDOW_HOURS = 72;
const PER_CAMPAIGN_BUDGET = 100; // bound polls/tick to keep tier headroom

// ----------------------------------------------------------------------------

export async function handleWaPollStatusTick(): Promise<{ enqueued: number }> {
  const since = new Date(Date.now() - POLL_WINDOW_HOURS * 60 * 60 * 1000);
  // Active = has at least one SENT or DELIVERED row (non-terminal)
  // sent within the polling window.
  const active = await prisma.whatsAppCampaignSend.findMany({
    where: {
      status: { in: [WASendStatus.SENT, WASendStatus.DELIVERED] },
      sentAt: { gte: since },
    },
    select: { campaignId: true, tenantId: true },
    distinct: ['campaignId'],
    take: 500,
  });

  const queue = getQueue();
  for (const a of active) {
    await queue.add(
      'poll-campaign',
      { campaignId: a.campaignId, tenantId: a.tenantId },
      {
        jobId: `poll-campaign_${a.campaignId}`,
        removeOnComplete: 50,
        removeOnFail: 50,
        attempts: 1,
      },
    );
  }
  console.info(
    `[cron:wa-poll-status] enqueued ${active.length} campaign polls`,
  );
  return { enqueued: active.length };
}

export async function handleWaPollCampaign(job: Job): Promise<void> {
  const payload = pollCampaignPayloadSchema.parse(job.data);
  const { campaignId, tenantId } = payload;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      whatsAppCampaign: {
        include: { whatsAppAccount: true },
      },
    },
  });
  if (!campaign || !campaign.whatsAppCampaign) return;
  if (campaign.whatsAppCampaign.whatsAppAccount.status !== WAStatus.CONNECTED) {
    return;
  }

  const accessToken = decrypt(
    campaign.whatsAppCampaign.whatsAppAccount
      .accessTokenEncrypted as unknown as EncryptedField,
    tenantId,
  );

  // Pull non-terminal sends with a metaMessageId; cap by budget.
  const sends = await withTenant(tenantId, (tx) =>
    tx.whatsAppCampaignSend.findMany({
      where: {
        tenantId,
        campaignId,
        status: { in: [WASendStatus.SENT, WASendStatus.DELIVERED] },
        metaMessageId: { not: null },
      },
      orderBy: { sentAt: 'asc' },
      take: PER_CAMPAIGN_BUDGET,
    }),
  );

  let updated = 0;
  for (const s of sends) {
    if (!s.metaMessageId) continue;
    try {
      const status = await getMessageStatus(s.metaMessageId, accessToken);
      const transition = mapMetaStatus(status.status, s.status);
      if (!transition) continue;
      const now = new Date();
      await withTenant(tenantId, async (tx) => {
        await tx.whatsAppCampaignSend.update({
          where: { id: s.id },
          data: {
            status: transition.status,
            ...(transition.deliveredAt ? { deliveredAt: now } : {}),
            ...(transition.readAt ? { readAt: now } : {}),
            lastEventAt: now,
          },
        });
        // Mirror onto the inbox-side message row by metaMessageId.
        await tx.whatsAppMessage.updateMany({
          where: { tenantId, metaMessageId: s.metaMessageId! },
          data: {
            status: transition.status,
            ...(transition.deliveredAt ? { deliveredAt: now } : {}),
            ...(transition.readAt ? { readAt: now } : {}),
          },
        });
        if (transition.status === WASendStatus.DELIVERED) {
          await tx.contactEvent.create({
            data: {
              tenantId,
              contactId: s.contactId,
              type: ContactEventType.WHATSAPP_DELIVERED,
              metadata: { campaignId } as Prisma.JsonObject,
            },
          });
        } else if (transition.status === WASendStatus.READ) {
          await tx.contactEvent.create({
            data: {
              tenantId,
              contactId: s.contactId,
              type: ContactEventType.WHATSAPP_READ,
              metadata: { campaignId } as Prisma.JsonObject,
            },
          });
        }
      });
      updated += 1;
    } catch (err) {
      // Per-message Meta failures are silent — Meta returns 404 for
      // expired messages (>72h) routinely. Anything 5xx tier-wide is
      // surfaced to Sentry once per tick via the catch below.
      if (err instanceof MetaApiError && err.status >= 500) {
        Sentry.captureMessage(`wa-poll-status meta 5xx`, {
          level: 'warning',
          tags: { queue: 'wa-poll-status', tenantId, campaignId },
          extra: { metaCode: err.metaCode },
        });
        break; // bail this tick; next 2-min tick retries.
      }
    }
  }

  console.info(
    `[wa-poll-status] campaign ${campaignId} polled=${sends.length} transitions=${updated}`,
  );
}

/** Map Meta's lowercase status string to our transition. */
function mapMetaStatus(
  metaStatus: string | undefined,
  currentStatus: WASendStatus,
): {
  status: WASendStatus;
  deliveredAt?: boolean;
  readAt?: boolean;
} | null {
  if (!metaStatus) return null;
  if (metaStatus === 'delivered' && currentStatus === WASendStatus.SENT) {
    return { status: WASendStatus.DELIVERED, deliveredAt: true };
  }
  if (
    metaStatus === 'read' &&
    (currentStatus === WASendStatus.SENT ||
      currentStatus === WASendStatus.DELIVERED)
  ) {
    return { status: WASendStatus.READ, readAt: true };
  }
  if (metaStatus === 'failed') {
    return { status: WASendStatus.FAILED };
  }
  return null;
}
