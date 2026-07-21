import { NextResponse } from 'next/server';

import { CheckoutOrderStatus, prisma } from '@getyn/db';

import { appBaseUrl } from '@/server/auth/auth0';
import { getXpaySubscription } from '@/server/integrations/xpay';

/**
 * XPay redirects the shopper here after the hosted checkout completes.
 * We NEVER trust the query params — always verify server-side via
 * getXpaySubscription before flipping the order to PAID.
 *
 * On success → 302 /checkout/confirmation?ref=<merchantReference>
 * On failure → 302 /checkout/<merchantReference>?error=<reason>
 *
 * The confirmation page re-fetches the order via tRPC and gates on
 * status === PAID, so even a spoofed redirect to /checkout/confirmation
 * cannot bypass the gate.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const ref = url.searchParams.get('ref');
  if (!ref) {
    return NextResponse.redirect(new URL('/pricing', appBaseUrl()));
  }

  const order = await prisma.checkoutOrder.findUnique({
    where: { merchantReference: ref },
    select: {
      id: true,
      status: true,
      xpaySubscriptionId: true,
      merchantReference: true,
    },
  });
  if (!order) {
    return NextResponse.redirect(new URL('/pricing', appBaseUrl()));
  }

  // Already terminal — just bounce to the right place.
  if (order.status === CheckoutOrderStatus.PAID) {
    return NextResponse.redirect(
      new URL(`/checkout/confirmation?ref=${ref}`, appBaseUrl()),
    );
  }

  // Verify with XPay before flipping. Without a subscription id we
  // can't verify — bounce back to the checkout page with an error so
  // the shopper can retry.
  if (!order.xpaySubscriptionId) {
    return NextResponse.redirect(
      new URL(
        `/checkout/${encodeURIComponent(ref)}?error=missing_subscription_id`,
        appBaseUrl(),
      ),
    );
  }

  const verify = await getXpaySubscription(order.xpaySubscriptionId);
  const status = (verify.status ?? '').toUpperCase();
  const isSuccess = status === 'ACTIVE' || status === 'SUCCESS' || status === 'PAID';

  if (isSuccess) {
    await prisma.checkoutOrder.update({
      where: { id: order.id },
      data: {
        status: CheckoutOrderStatus.PAID,
        paidAt: new Date(),
        failureReason: null,
      },
    });
    return NextResponse.redirect(
      new URL(`/checkout/confirmation?ref=${ref}`, appBaseUrl()),
    );
  }

  // Not success — record failure + kick back to step 2.
  const reason =
    verify.status ??
    (verify.ok ? 'unknown_status' : 'xpay_verification_failed');
  await prisma.checkoutOrder.update({
    where: { id: order.id },
    data: {
      status: CheckoutOrderStatus.FAILED,
      failedAt: new Date(),
      failureReason: reason,
    },
  });
  return NextResponse.redirect(
    new URL(
      `/checkout/${encodeURIComponent(ref)}?error=${encodeURIComponent(reason)}`,
      appBaseUrl(),
    ),
  );
}
