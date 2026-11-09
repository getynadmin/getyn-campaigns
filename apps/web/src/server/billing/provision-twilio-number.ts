import { TwilioPhoneNumberStatus, prisma } from '@getyn/db';

import { purchasePhoneNumber } from '@/server/integrations/twilio';
import { publishNotification } from '@/server/notifications/publish';

/**
 * Called after a CheckoutOrder with upgradeMethod='twilio_number_purchase'
 * flips to PAID. Picks up the PENDING TwilioPhoneNumber row stashed at
 * checkout start, calls Twilio to actually purchase the number, and
 * flips the row to ACTIVE with the real twilioSid.
 *
 * Idempotent: if the pending row is already ACTIVE / RELEASED /
 * PURCHASE_FAILED, this is a no-op. Safe to call from both the xPay
 * return handler and the webhook.
 */
export async function provisionTwilioNumberOrder(orderId: string): Promise<{
  applied: boolean;
  reason?: string;
}> {
  const pending = await prisma.twilioPhoneNumber.findFirst({
    where: { checkoutOrderId: orderId },
  });
  if (!pending) return { applied: false, reason: 'no_pending_row' };
  if (pending.status !== TwilioPhoneNumberStatus.PENDING) {
    return { applied: false, reason: 'not_pending' };
  }

  const purchase = await purchasePhoneNumber(
    pending.phoneNumber,
    pending.friendlyName ?? undefined,
  );

  if (!purchase.ok) {
    await prisma.twilioPhoneNumber.update({
      where: { id: pending.id },
      data: { status: TwilioPhoneNumberStatus.PURCHASE_FAILED },
    });
    await prisma.checkoutOrder.update({
      where: { id: orderId },
      data: {
        failureReason:
          `Twilio refused the purchase: ${purchase.error}` +
          ' — manual refund required.',
      },
    });
    console.warn('[twilio-provision] purchase failed', {
      orderId,
      phoneNumber: pending.phoneNumber,
      error: purchase.error,
    });
    return { applied: false, reason: 'twilio_refused' };
  }

  await prisma.twilioPhoneNumber.update({
    where: { id: pending.id },
    data: {
      status: TwilioPhoneNumberStatus.ACTIVE,
      twilioSid: purchase.number.sid,
      capabilities: purchase.number.capabilities,
      friendlyName: purchase.number.friendlyName ?? pending.friendlyName,
      purchasedAt: new Date(),
    },
  });

  const tenant = await prisma.tenant.findUnique({
    where: { id: pending.tenantId },
    select: { slug: true },
  });
  if (tenant) {
    await publishNotification({
      tenantId: pending.tenantId,
      kind: 'SMS_NUMBER_PURCHASED',
      title: `Number ${purchase.number.phoneNumber} is active`,
      body: 'Ready to use as the from-number on SMS campaigns.',
      href: `/t/${tenant.slug}/channels/sms`,
    });
  }
  return { applied: true };
}
