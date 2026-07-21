import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { CheckoutOrderStatus, prisma } from '@getyn/db';

import {
  getXpayCredentials,
  getXpaySubscription,
} from '@/server/integrations/xpay';

/**
 * XPay Checkout webhook — backstop for the return-URL flow.
 *
 * We verify a signature header (name and algorithm per XPay docs — if
 * their production format differs, adjust HEADER + ALGO below).
 * Then we re-verify status via getXpaySubscription for defence-in-depth
 * (never trust the webhook payload alone) and update the order
 * idempotently.
 *
 * Responds 200 on any handled event so XPay doesn't retry forever;
 * bad signatures return 401.
 */
const HEADER = 'x-xpay-signature';

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const signature = request.headers.get(HEADER);
  const creds = await getXpayCredentials();

  if (creds.webhookSecret) {
    if (!signature) {
      return NextResponse.json({ error: 'missing_signature' }, { status: 401 });
    }
    const expected = createHmac('sha256', creds.webhookSecret)
      .update(raw)
      .digest('hex');
    // Length-check before timingSafeEqual — mismatched-length buffers throw.
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
    ) {
      return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
    }
  }

  let body: {
    merchantReference?: string;
    subscriptionId?: string;
    status?: string;
    event?: string;
  } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const ref = body.merchantReference;
  if (!ref) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const order = await prisma.checkoutOrder.findUnique({
    where: { merchantReference: ref },
    select: { id: true, status: true, xpaySubscriptionId: true },
  });
  if (!order) {
    return NextResponse.json({ ok: true, ignored: 'no_order' });
  }
  if (order.status === CheckoutOrderStatus.PAID) {
    return NextResponse.json({ ok: true, already: 'PAID' });
  }

  // Re-verify with XPay — never trust the webhook body alone.
  const subId = body.subscriptionId ?? order.xpaySubscriptionId;
  if (!subId) {
    return NextResponse.json({ ok: true, ignored: 'no_subscription_id' });
  }
  const verify = await getXpaySubscription(subId);
  const status = (verify.status ?? '').toUpperCase();
  const isSuccess =
    status === 'ACTIVE' || status === 'SUCCESS' || status === 'PAID';

  if (isSuccess) {
    await prisma.checkoutOrder.update({
      where: { id: order.id },
      data: {
        status: CheckoutOrderStatus.PAID,
        paidAt: new Date(),
        xpaySubscriptionId: subId,
        failureReason: null,
      },
    });
    return NextResponse.json({ ok: true, updated: 'PAID' });
  }

  const shouldFail = status === 'FAILED' || status === 'CANCELED';
  if (shouldFail) {
    await prisma.checkoutOrder.update({
      where: { id: order.id },
      data: {
        status:
          status === 'CANCELED'
            ? CheckoutOrderStatus.CANCELED
            : CheckoutOrderStatus.FAILED,
        failedAt: new Date(),
        failureReason: status || 'unknown',
      },
    });
  }
  return NextResponse.json({ ok: true, verifiedStatus: status });
}
