import { redirect } from 'next/navigation';

import { CheckoutOrderStatus, prisma } from '@getyn/db';

export const dynamic = 'force-dynamic';

/**
 * Return-with-error entry point. XPay bounced back with an error, so
 * we re-render step 2 pre-filled from the persisted order, showing
 * the error banner for retry. If the order is already PAID (webhook
 * updated it before the redirect), forward straight to confirmation.
 */
export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: { ref: string };
  searchParams: { error?: string };
}): Promise<JSX.Element> {
  const order = await prisma.checkoutOrder.findUnique({
    where: { merchantReference: params.ref },
    select: {
      status: true,
      planSlug: true,
      volumeMessages: true,
      billingCycle: true,
    },
  });
  if (!order) redirect('/pricing');
  if (order.status === CheckoutOrderStatus.PAID) {
    redirect(`/checkout/confirmation?ref=${encodeURIComponent(params.ref)}`);
  }

  const qs = new URLSearchParams({
    plan: order.planSlug,
    volume: String(order.volumeMessages),
    cycle: order.billingCycle,
    ...(searchParams.error ? { error: searchParams.error } : {}),
  });
  redirect(`/checkout?${qs.toString()}`);
}
