/* eslint-disable no-console */
import { NextResponse, type NextRequest } from 'next/server';

import {
  CampaignEventType,
  CampaignSendStatus,
  ContactEventType,
  emitContactEvent,
  prisma,
  withTenant,
} from '@getyn/db';

/**
 * Open-tracking pixel — `/api/track/open/{campaignSendId}`.
 *
 * Returns a 1×1 transparent GIF unconditionally. Behind the response we
 * record an OPENED CampaignEvent + ContactEvent if this is the first
 * open within the dedup window for this send.
 *
 * Dedup window: 1 hour. Apple Mail's privacy proxy and Gmail's image
 * proxy fire prefetches that look like real opens — we don't want every
 * recipient inflating to 2-5 events. The kickoff prompt's pushback #3
 * proposed Redis-based dedup; for MVP we use a cheap DB query against
 * (campaignSendId, type=OPENED, occurredAt > now-1h). The resulting
 * read load is one indexed lookup per pixel hit — acceptable until
 * traffic warrants the Redis upgrade.
 *
 * Bot UA filter: Googlebot, Bingbot, common email security scanners.
 * They fetch images during link/spam scans and shouldn't count as user
 * opens.
 */

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const BOT_UA_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /slurp/i, // Yahoo
  /barracuda/i,
  /proofpoint/i,
  /mimecast/i,
  /symantec/i,
  /spamfilter/i,
  /linkchecker/i,
];

const DEDUP_WINDOW_MS = 60 * 60 * 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // Always respond with the GIF first; tracking is best-effort.
  // Process the event in fire-and-forget mode so the email client gets
  // its image quickly even when the DB is slow.
  const campaignSendId = params.id;
  const userAgent = req.headers.get('user-agent') ?? '';
  const isBot = BOT_UA_PATTERNS.some((re) => re.test(userAgent));

  if (!isBot) {
    void recordOpen(campaignSendId, userAgent).catch((err) => {
      console.error(`[track:open] ${campaignSendId} record failed:`, err);
    });
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_GIF.length.toString(),
      'Cache-Control': 'no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

async function recordOpen(
  campaignSendId: string,
  userAgent: string,
): Promise<void> {
  // Look up the send row OUTSIDE withTenant so we get the tenantId.
  const send = await prisma.campaignSend.findUnique({
    where: { id: campaignSendId },
    select: {
      id: true,
      tenantId: true,
      contactId: true,
      campaignId: true,
      status: true,
    },
  });
  if (!send) return;

  // Dedup: skip if we already saw an OPENED event in the last hour.
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
  const recentOpen = await prisma.campaignEvent.findFirst({
    where: {
      campaignSendId: send.id,
      type: CampaignEventType.OPENED,
      occurredAt: { gte: cutoff },
    },
    select: { id: true },
  });
  if (recentOpen) return;

  // Promote status to OPENED if currently SENT/DELIVERED. Don't downgrade
  // CLICKED to OPENED — clicked is "stronger".
  await withTenant(send.tenantId, async (tx) => {
    if (
      send.status === CampaignSendStatus.SENT ||
      send.status === CampaignSendStatus.DELIVERED
    ) {
      await tx.campaignSend.update({
        where: { id: send.id },
        data: {
          status: CampaignSendStatus.OPENED,
          lastEventAt: new Date(),
        },
      });
    }
    await tx.campaignEvent.create({
      data: {
        tenantId: send.tenantId,
        campaignSendId: send.id,
        campaignId: send.campaignId,
        type: CampaignEventType.OPENED,
        metadata: { userAgent: userAgent.slice(0, 256) },
        occurredAt: new Date(),
      },
    });
    await emitContactEvent(tx, {
      tenantId: send.tenantId,
      contactId: send.contactId,
      type: ContactEventType.EMAIL_OPENED,
      metadata: { campaignId: send.campaignId },
    });
  });
}
