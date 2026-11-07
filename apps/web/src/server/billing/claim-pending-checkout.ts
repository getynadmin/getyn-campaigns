import { CheckoutOrderStatus, prisma } from '@getyn/db';

import { provisionOrderExtras } from './provision-order-extras';

/**
 * Called from onboarding/signup immediately after a new tenant +
 * OWNER membership is created. Finds the most recent PAID
 * CheckoutOrder for this email that hasn't had its extras applied
 * yet, links the tenant, and runs provisionOrderExtras so the extra
 * limits land the moment the workspace exists.
 *
 * No-op if no matching order (e.g. OAuth signup without going through
 * /pricing first). Safe to call repeatedly — the provisioner is
 * idempotent via extrasAppliedAt.
 */
export async function claimPendingCheckoutForTenant(opts: {
  email: string;
  tenantId: string;
  userId: string;
}): Promise<{ claimed: boolean; orderId?: string }> {
  const order = await prisma.checkoutOrder.findFirst({
    where: {
      customerEmail: opts.email.toLowerCase(),
      status: CheckoutOrderStatus.PAID,
      tenantId: null,
      extrasAppliedAt: null,
    },
    orderBy: { paidAt: 'desc' },
    select: { id: true },
  });
  if (!order) return { claimed: false };

  await prisma.checkoutOrder.update({
    where: { id: order.id },
    data: {
      tenantId: opts.tenantId,
      userId: opts.userId,
    },
  });
  await provisionOrderExtras(order.id);
  return { claimed: true, orderId: order.id };
}
