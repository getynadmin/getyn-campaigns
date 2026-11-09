/* eslint-disable no-console */
import { NextResponse, type NextRequest } from 'next/server';

import { prisma, SmsSendStatus } from '@getyn/db';

/**
 * Twilio delivery-status callback.
 *
 * Twilio POSTs form-urlencoded with:
 *   MessageSid=<SID>
 *   MessageStatus=queued|sent|delivered|failed|undelivered
 *   ErrorCode=<optional>
 *
 * We look up the SmsCampaignSend by providerMessageId and flip its
 * status. Twilio request-signature validation is deferred — the
 * endpoint is URL-opaque (no PII in response) and the next hardening
 * pass will add X-Twilio-Signature verification against the
 * integration's auth token.
 */
function mapStatus(s: string | null): SmsSendStatus | null {
  switch ((s ?? '').toLowerCase()) {
    case 'sent':
      return SmsSendStatus.SENT;
    case 'delivered':
      return SmsSendStatus.DELIVERED;
    case 'failed':
      return SmsSendStatus.FAILED;
    case 'undelivered':
      return SmsSendStatus.UNDELIVERED;
    default:
      return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const params = new URLSearchParams(body);
  const sid = params.get('MessageSid');
  const status = mapStatus(params.get('MessageStatus'));
  const errorCode = params.get('ErrorCode');

  if (!sid || !status) {
    return NextResponse.json({ ok: true });
  }

  try {
    await prisma.smsCampaignSend.updateMany({
      where: { providerMessageId: sid },
      data: {
        status,
        lastEventAt: new Date(),
        ...(status === SmsSendStatus.DELIVERED
          ? { deliveredAt: new Date() }
          : {}),
        ...(errorCode ? { errorCode } : {}),
      },
    });
  } catch (err) {
    console.error('[twilio-status] update failed', err);
  }
  return NextResponse.json({ ok: true });
}
