import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { CheckoutOrderStatus, prisma } from '@getyn/db';

import { appBaseUrl } from '@/server/auth/auth0';
import {
  calculatePrice,
  readPricingConfig,
} from '@/server/billing/dynamic-pricing';
import {
  createXpaySubscription,
  getXpayCredentials,
} from '@/server/integrations/xpay';

import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * Phase 9 — public checkout surface.
 *
 * The /checkout page walks a shopper through 3 steps: Account →
 * Payment → Confirmation. tRPC only backs steps 1 and 2 — step 3
 * loads via `getByReference` and re-checks status server-side.
 *
 * `startOrder` (step 2 → Continue): validates the account, creates
 * an XPay subscription intent, and returns the hosted-checkout URL.
 * The client redirects the shopper to it. When XPay finishes, they
 * return to /api/payments/xpay/return which flips the order to PAID
 * only after server-side verification via getXpaySubscription.
 */
export const checkoutRouter = createTRPCRouter({
  /**
   * Read the current order by its merchant reference (URL slug).
   * Used by step 3 to gate access — only PAID orders render the
   * confirmation view.
   */
  getByReference: publicProcedure
    .input(z.object({ merchantReference: z.string().min(1).max(80) }))
    .query(async ({ input }) => {
      const row = await prisma.checkoutOrder.findUnique({
        where: { merchantReference: input.merchantReference },
        select: {
          id: true,
          merchantReference: true,
          status: true,
          planName: true,
          planSlug: true,
          volumeMessages: true,
          billingCycle: true,
          amountCents: true,
          currency: true,
          customerEmail: true,
          customerFirstName: true,
          customerLastName: true,
          failureReason: true,
          paidAt: true,
          tenantId: true,
        },
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  /**
   * Step 2 submit — record the customer + start an XPay intent.
   *
   * Reruns the price calculation server-side (never trust the client
   * on money). If XPay is disabled or in preview mode, returns a
   * `previewMode: true` result so the UI can flag "no real charge".
   */
  startOrder: publicProcedure
    .input(
      z.object({
        planSlug: z.string().min(1).max(60),
        volume: z.number().int().min(1).max(100_000_000),
        billingCycle: z.enum(['monthly', 'annual']),
        customer: z.object({
          email: z.string().trim().email(),
          firstName: z.string().trim().max(80),
          lastName: z.string().trim().max(80).optional().default(''),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      // 1) Resolve plan + pricing.
      const plan = await prisma.plan.findFirst({
        where: { slug: input.planSlug, isArchived: false },
        select: {
          id: true,
          slug: true,
          name: true,
          metadata: true,
          currency: true,
        },
      });
      if (!plan) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Plan not found.',
        });
      }
      const cfg = readPricingConfig(plan.metadata);
      if (!cfg) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This plan does not support dynamic checkout.',
        });
      }
      const quote = calculatePrice(input.volume, cfg);
      const amountCents =
        input.billingCycle === 'monthly' ? quote.monthlyCents : quote.yearlyCents;

      // 2) Persist the order in DRAFT.
      const merchantReference = `co_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const order = await prisma.checkoutOrder.create({
        data: {
          merchantReference,
          status: CheckoutOrderStatus.DRAFT,
          planId: plan.id,
          planSlug: plan.slug,
          planName: plan.name,
          volumeMessages: quote.volume,
          billingCycle: input.billingCycle,
          amountCents,
          currency: cfg.currency,
          customerEmail: input.customer.email.toLowerCase(),
          customerFirstName: input.customer.firstName,
          customerLastName: input.customer.lastName || null,
        },
        select: { id: true, merchantReference: true },
      });

      // 3) Call XPay. If disabled or misconfigured, keep the order in
      //    DRAFT + return previewMode:true so the operator sees the
      //    flow without a real charge.
      const creds = await getXpayCredentials();
      if (!creds.privateKey || !creds.publicKey) {
        return {
          ok: true,
          previewMode: true as const,
          merchantReference: order.merchantReference,
          fwdUrl: null,
          message:
            'XPay is not configured — the order is recorded but no charge was created.',
        };
      }
      const callbackUrl = new URL(
        `/api/payments/xpay/return?ref=${encodeURIComponent(order.merchantReference)}`,
        creds.callbackBaseUrl ?? appBaseUrl(),
      ).toString();

      const created = await createXpaySubscription({
        planName: plan.name,
        amountCents,
        currency: cfg.currency,
        billingCycle: input.billingCycle,
        merchantReference: order.merchantReference,
        callbackUrl,
        customer: {
          email: input.customer.email,
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
        },
        metadata: {
          planSlug: plan.slug,
          volume: String(quote.volume),
          billingCycle: input.billingCycle,
        },
      });

      if (!created.ok || !created.fwdUrl) {
        await prisma.checkoutOrder.update({
          where: { id: order.id },
          data: {
            status: CheckoutOrderStatus.FAILED,
            failedAt: new Date(),
            failureReason:
              created.message ?? 'XPay did not return a checkout URL.',
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
        ok: true,
        previewMode: false as const,
        merchantReference: order.merchantReference,
        fwdUrl: created.fwdUrl,
      };
    }),
});
