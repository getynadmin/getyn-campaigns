import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  CheckoutOrderStatus,
  Role,
  TwilioPhoneNumberStatus,
  AlphaSenderIdStatus,
  prisma,
} from '@getyn/db';

import { appBaseUrl } from '@/server/auth/auth0';
import {
  ALPHA_SENDER_COUNTRIES,
  COMMON_PHONE_NUMBER_COUNTRIES,
  createAlphaSender,
  ensureTenantMessagingService,
  getTwilioCredentials,
  listAvailablePhoneNumbers,
  listSupportedAlphaSenderCountries,
  releasePhoneNumber,
} from '@/server/integrations/twilio';
import {
  createXpaySubscription,
  getXpayCredentials,
} from '@/server/integrations/xpay';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Phase 10 — tenant-side SMS channel: buy real Twilio numbers, or
 * register alphanumeric sender IDs (brand names). SmsCampaign.fromNumber
 * resolves against these at send time.
 *
 * Purchases flow through xPay with method='twilio_number_purchase'. The
 * existing xPay return/webhook handlers call provisionTwilioNumberOrder
 * (see server/billing/provision-twilio-number.ts) on PAID — the actual
 * Twilio IncomingPhoneNumbers.create call runs there, idempotent.
 */
export const smsChannelRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const creds = await getTwilioCredentials();
    const [phoneNumbers, alphaSenders, tenant] = await Promise.all([
      prisma.twilioPhoneNumber.findMany({
        where: { tenantId, status: TwilioPhoneNumberStatus.ACTIVE },
        orderBy: { purchasedAt: 'desc' },
      }),
      prisma.alphanumericSenderId.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { twilioMessagingServiceSid: true },
      }),
    ]);
    return {
      phoneNumbers,
      alphaSenders,
      messagingServiceSid: tenant?.twilioMessagingServiceSid ?? null,
      twilioReady: Boolean(
        creds.enabled && creds.config?.accountSid && creds.authToken,
      ),
      countries: COMMON_PHONE_NUMBER_COUNTRIES,
      alphaCountries: listSupportedAlphaSenderCountries(),
    };
  }),

  searchAvailableNumbers: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        country: z.string().trim().length(2),
        page: z.number().int().min(0).max(50).default(0),
        areaCode: z.string().trim().max(10).optional(),
        contains: z.string().trim().max(20).optional(),
      }),
    )
    .query(async ({ input }) => {
      const res = await listAvailablePhoneNumbers({
        country: input.country,
        page: input.page,
        pageSize: 10,
        areaCode: input.areaCode || undefined,
        contains: input.contains || undefined,
      });
      if (!res.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: res.error });
      }
      return { numbers: res.numbers };
    }),

  startPurchaseCheckout: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        phoneNumber: z.string().trim().regex(/^\+[1-9]\d{6,14}$/),
        country: z.string().trim().length(2),
        monthlyPriceCents: z.number().int().min(50).max(50_000),
        friendlyName: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = ctx.tenantContext.tenant;
      // Resolve any plan the tenant currently has — CheckoutOrder
      // requires a planId FK even for ad-hoc one-off purchases. We
      // reuse the tenant's current plan (or the default plan) as a
      // non-billing anchor; amount comes from Twilio's price, not the plan.
      const tenantSub = await prisma.subscription.findUnique({
        where: { tenantId: tenant.id },
        select: { planId: true, plan: { select: { slug: true, name: true } } },
      });
      let planRef = tenantSub
        ? { id: tenantSub.planId, slug: tenantSub.plan.slug, name: tenantSub.plan.name }
        : null;
      if (!planRef) {
        const fallback = await prisma.plan.findFirst({
          where: { isArchived: false },
          orderBy: [{ isDefault: 'desc' }, { priceMonthlyCents: 'asc' }],
          select: { id: true, slug: true, name: true },
        });
        if (!fallback) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No plan configured — cannot anchor this purchase.',
          });
        }
        planRef = fallback;
      }
      const merchantReference = `tnp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

      const order = await prisma.checkoutOrder.create({
        data: {
          merchantReference,
          status: CheckoutOrderStatus.DRAFT,
          planId: planRef.id,
          planSlug: planRef.slug,
          planName: `Phone number — ${input.phoneNumber}`,
          volumeMessages: 0,
          billingCycle: 'monthly',
          amountCents: input.monthlyPriceCents,
          currency: 'USD',
          customerEmail: ctx.user.email,
          customerFirstName: ctx.user.name ?? '',
          upgradeMethod: 'twilio_number_purchase',
          tenantId: tenant.id,
          userId: ctx.user.id,
        },
        select: { id: true, merchantReference: true },
      });

      // Stash the purchase intent as a PENDING TwilioPhoneNumber row
      // keyed to the checkout order. The provisioner picks it up on
      // PAID and runs the real Twilio IncomingPhoneNumbers.create.
      await prisma.twilioPhoneNumber.create({
        data: {
          tenantId: tenant.id,
          country: input.country.toUpperCase(),
          phoneNumber: input.phoneNumber,
          friendlyName: input.friendlyName ?? null,
          twilioSid: `pending_${order.id}`, // placeholder to satisfy @unique
          monthlyPriceCents: input.monthlyPriceCents,
          status: TwilioPhoneNumberStatus.PENDING,
          checkoutOrderId: order.id,
        },
      });
      const creds = await getXpayCredentials();
      if (!creds.privateKey || !creds.publicKey) {
        // Preview mode: no real charge. Flip the order to PAID and
        // run the provisioner immediately (same path the webhook uses).
        await prisma.checkoutOrder.update({
          where: { id: order.id },
          data: { status: CheckoutOrderStatus.PAID, paidAt: new Date() },
        });
        const { provisionTwilioNumberOrder } = await import(
          '@/server/billing/provision-twilio-number'
        );
        await provisionTwilioNumberOrder(order.id);
        return {
          ok: true as const,
          previewMode: true as const,
          merchantReference: order.merchantReference,
          fwdUrl: null,
          message: 'xPay is not configured — the number was purchased directly.',
        };
      }
      const callbackUrl = new URL(
        `/api/payments/xpay/return?ref=${encodeURIComponent(order.merchantReference)}`,
        creds.callbackBaseUrl ?? appBaseUrl(),
      ).toString();
      const created = await createXpaySubscription({
        planName: `Phone number ${input.phoneNumber}`,
        amountCents: input.monthlyPriceCents,
        currency: 'USD',
        billingCycle: 'monthly',
        merchantReference: order.merchantReference,
        callbackUrl,
        customer: {
          email: ctx.user.email,
          name: ctx.user.name ?? ctx.user.email,
          contactNumber: '+10000000000',
        },
        metadata: {
          purpose: 'twilio_number_purchase',
          phoneNumber: input.phoneNumber,
          country: input.country,
          friendlyName: input.friendlyName ?? '',
          monthlyPriceCents: String(input.monthlyPriceCents),
          tenantId: tenant.id,
        },
      });
      if (!created.ok || !created.fwdUrl) {
        await prisma.checkoutOrder.update({
          where: { id: order.id },
          data: {
            status: CheckoutOrderStatus.FAILED,
            failedAt: new Date(),
            failureReason: created.message ?? 'xPay did not return a checkout URL.',
          },
        });
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: created.message ?? 'Payment gateway rejected the request.',
        });
      }
      await prisma.checkoutOrder.update({
        where: { id: order.id },
        data: {
          status: CheckoutOrderStatus.PENDING,
          xpaySubscriptionId: created.subscriptionId ?? null,
          xpayFwdUrl: created.fwdUrl,
        },
      });
      return {
        ok: true as const,
        previewMode: false as const,
        merchantReference: order.merchantReference,
        fwdUrl: created.fwdUrl,
      };
    }),

  registerAlphaSender: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        senderId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9]{1,11}$/, '1–11 alphanumeric characters only.'),
        country: z.string().trim().length(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenant = ctx.tenantContext.tenant;
      const country = input.country.toUpperCase();
      if (!ALPHA_SENDER_COUNTRIES.some((c) => c.code === country)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Alphanumeric sender IDs are not supported for this country.',
        });
      }
      const senderId = input.senderId.toUpperCase();

      const existing = await prisma.alphanumericSenderId.findUnique({
        where: {
          tenantId_senderId_country: {
            tenantId: tenant.id,
            senderId,
            country,
          },
        },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This sender ID is already registered for that country.',
        });
      }

      const svc = await ensureTenantMessagingService(
        tenant.twilioMessagingServiceSid ?? null,
        tenant.slug,
      );
      if (!svc.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: svc.error });
      if (!tenant.twilioMessagingServiceSid) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { twilioMessagingServiceSid: svc.sid },
        });
      }

      const created = await createAlphaSender(svc.sid, senderId);
      if (!('ok' in created) || !created.ok) {
        const err = created as { error: string };
        throw new TRPCError({ code: 'BAD_REQUEST', message: err.error });
      }
      const row = await prisma.alphanumericSenderId.create({
        data: {
          tenantId: tenant.id,
          senderId,
          country,
          status: AlphaSenderIdStatus.APPROVED,
          twilioSid: created.sid,
          messagingServiceSid: svc.sid,
          submittedAt: new Date(),
          approvedAt: new Date(),
        },
      });
      // Fire-and-forget notification.
      const { publishNotification } = await import(
        '@/server/notifications/publish'
      );
      await publishNotification({
        tenantId: tenant.id,
        kind: 'SMS_SENDER_ID_APPROVED',
        title: `Sender ID "${senderId}" approved`,
        body: `Ready to use as the sender for SMS campaigns to ${country}.`,
        href: `/t/${tenant.slug}/channels/sms`,
      });
      return { ok: true as const, alphaSender: row };
    }),

  releaseNumber: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await prisma.twilioPhoneNumber.findFirst({
        where: { id: input.id, tenantId },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const res = await releasePhoneNumber(row.twilioSid);
      if (!res.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: res.error });
      await prisma.twilioPhoneNumber.update({
        where: { id: row.id },
        data: { status: TwilioPhoneNumberStatus.RELEASED, releasedAt: new Date() },
      });
      return { ok: true as const };
    }),

  deleteAlphaSender: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await prisma.alphanumericSenderId.findFirst({
        where: { id: input.id, tenantId },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      // Twilio AlphaSender delete endpoint — soft failure acceptable;
      // our local row goes away either way.
      try {
        const creds = await getTwilioCredentials();
        if (
          creds.enabled &&
          creds.config &&
          creds.authToken &&
          row.messagingServiceSid &&
          row.twilioSid
        ) {
          await fetch(
            `https://messaging.twilio.com/v1/Services/${encodeURIComponent(row.messagingServiceSid)}/AlphaSenders/${encodeURIComponent(row.twilioSid)}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `Basic ${Buffer.from(`${creds.config.accountSid}:${creds.authToken}`).toString('base64')}`,
              },
            },
          );
        }
      } catch (err) {
        console.warn('[smsChannel] alpha sender twilio delete failed', err);
      }
      await prisma.alphanumericSenderId.delete({ where: { id: row.id } });
      return { ok: true as const };
    }),

  /** Senders usable as a from-value when building an SMS campaign. */
  sendersForCampaign: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    const [numbers, senders] = await Promise.all([
      prisma.twilioPhoneNumber.findMany({
        where: { tenantId, status: TwilioPhoneNumberStatus.ACTIVE },
        orderBy: { purchasedAt: 'desc' },
        select: {
          id: true,
          phoneNumber: true,
          friendlyName: true,
          country: true,
        },
      }),
      prisma.alphanumericSenderId.findMany({
        where: { tenantId, status: AlphaSenderIdStatus.APPROVED },
        orderBy: { createdAt: 'desc' },
        select: { id: true, senderId: true, country: true },
      }),
    ]);
    return { numbers, alphaSenders: senders };
  }),
});
