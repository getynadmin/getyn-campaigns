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
 * Click-tracking redirector — `/r/{slug}?s={campaignSendId}`.
 *
 * Resolves the slug to a TrackingLink, records a CLICKED CampaignEvent
 * + ContactEvent for the recipient identified by `?s=`, increments
 * `TrackingLink.clickCount`, then 302s to the original URL.
 *
 * Bot UA filter: same list as the open tracker. Bot clicks don't count.
 *
 * Failure modes:
 *   - Slug unknown:    302 to / (graceful — most likely a stale email).
 *   - Send id unknown: still resolve the link, just skip event recording.
 *   - DB blip:         we still 302 to originalUrl — never block the user.
 */

const BOT_UA_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /slurp/i,
  /barracuda/i,
  /proofpoint/i,
  /mimecast/i,
  /symantec/i,
  /linkchecker/i,
];

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<NextResponse> {
  const slug = params.slug;
  const sendId = req.nextUrl.searchParams.get('s');
  const userAgent = req.headers.get('user-agent') ?? '';
  const referer = req.headers.get('referer') ?? null;
  const isBot = BOT_UA_PATTERNS.some((re) => re.test(userAgent));

  // Resolve the slug. If unknown, send to root — the user clicked a
  // stale or malformed tracking URL.
  const link = await prisma.trackingLink.findUnique({
    where: { slug },
    select: {
      id: true,
      tenantId: true,
      campaignId: true,
      originalUrl: true,
    },
  });

  if (!link) {
    const root = req.nextUrl.clone();
    root.pathname = '/';
    root.search = '';
    return NextResponse.redirect(root, 302);
  }

  // Increment counter + record event in fire-and-forget mode so the
  // user redirects fast even if the DB is slow.
  if (!isBot && sendId) {
    void recordClick(link.tenantId, link.id, link.campaignId, sendId, link.originalUrl, userAgent, referer).catch((err) => {
      console.error(`[track:click] slug=${slug} send=${sendId} record failed:`, err);
    });
  } else if (!isBot) {
    // No sendId — just bump the link's denormalized counter.
    void prisma.trackingLink
      .update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } })
      .catch(() => undefined);
  }

  return NextResponse.redirect(link.originalUrl, 302);
}

async function recordClick(
  tenantId: string,
  linkId: string,
  campaignId: string,
  campaignSendId: string,
  url: string,
  userAgent: string,
  referer: string | null,
): Promise<void> {
  // Verify the send belongs to the same tenant — defense against
  // someone tampering with the `?s=` to record clicks against a
  // different tenant's send.
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
  if (!send || send.tenantId !== tenantId) return;
  if (send.campaignId !== campaignId) return;

  await withTenant(tenantId, async (tx) => {
    // Status promotion: SENT/DELIVERED/OPENED → CLICKED.
    if (
      send.status === CampaignSendStatus.SENT ||
      send.status === CampaignSendStatus.DELIVERED ||
      send.status === CampaignSendStatus.OPENED
    ) {
      await tx.campaignSend.update({
        where: { id: send.id },
        data: {
          status: CampaignSendStatus.CLICKED,
          lastEventAt: new Date(),
        },
      });
    }
    await tx.campaignEvent.create({
      data: {
        tenantId,
        campaignSendId: send.id,
        campaignId,
        type: CampaignEventType.CLICKED,
        metadata: {
          url,
          userAgent: userAgent.slice(0, 256),
          referer: referer?.slice(0, 256) ?? null,
          trackingLinkId: linkId,
        },
        occurredAt: new Date(),
      },
    });
    await emitContactEvent(tx, {
      tenantId,
      contactId: send.contactId,
      type: ContactEventType.EMAIL_CLICKED,
      metadata: { campaignId, url, trackingLinkId: linkId },
    });
    await tx.trackingLink.update({
      where: { id: linkId },
      data: { clickCount: { increment: 1 } },
    });
  });
}
