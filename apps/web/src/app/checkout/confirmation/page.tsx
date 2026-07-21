import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';

import { CheckoutOrderStatus, prisma } from '@getyn/db';

export const dynamic = 'force-dynamic';

/**
 * Step 3. Server-renders after re-verifying the order status. Never
 * trust the query params — if status !== PAID, redirect back to
 * step 2 so a spoofed URL can't grant access.
 */
export default async function CheckoutConfirmationPage({
  searchParams,
}: {
  searchParams: { ref?: string };
}): Promise<JSX.Element> {
  const ref = searchParams.ref;
  if (!ref) redirect('/pricing');

  const order = await prisma.checkoutOrder.findUnique({
    where: { merchantReference: ref },
    select: {
      status: true,
      planName: true,
      volumeMessages: true,
      billingCycle: true,
      amountCents: true,
      currency: true,
      customerEmail: true,
    },
  });
  if (!order) redirect('/pricing');
  if (order.status !== CheckoutOrderStatus.PAID) {
    redirect(`/checkout/${encodeURIComponent(ref)}?error=payment_incomplete`);
  }

  const money = (order.amountCents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: order.currency,
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-6 py-16">
      <div className="w-full rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-9" />
        </div>
        <h1 className="text-2xl font-semibold">Payment successful</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Thank you — a receipt is on its way to{' '}
          <span className="font-medium text-foreground">{order.customerEmail}</span>.
        </p>

        <dl className="mt-6 space-y-2 rounded-lg border bg-muted/30 p-4 text-left text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="font-medium">{order.planName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Volume</dt>
            <dd className="font-medium">
              {order.volumeMessages.toLocaleString()} messages / month
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Billing</dt>
            <dd className="font-medium capitalize">{order.billingCycle}</dd>
          </div>
          <div className="flex justify-between border-t pt-2">
            <dt className="text-muted-foreground">Charged</dt>
            <dd className="font-semibold">{money}</dd>
          </div>
        </dl>

        <Link
          href="/welcome"
          className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow hover:opacity-90"
        >
          Go to dashboard →
        </Link>
        <p className="mt-3 text-[11px] text-muted-foreground">
          You&apos;ll create your workspace next.
        </p>
      </div>
    </div>
  );
}
