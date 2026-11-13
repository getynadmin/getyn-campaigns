import { z } from 'zod';

import { prisma } from '@getyn/db';

import {
  getMarketingOverview,
  runCartRecovery,
  runRetargeting,
  saveMarketingConfig,
} from '@/server/marketing';

import { createAdminRouter, staffProcedure, supportAdminProcedure } from '../admin-trpc';

/**
 * Phase 5.6 M8 — admin.marketing.*
 *
 * Retargeting + Cart Recovery CRUD and runners. Reads are open to
 * all staff; mutations and "Run now" require SUPPORT_ADMIN.
 */

const configUpdateSchema = z.object({
  retargetEnabled: z.boolean().optional(),
  cartEnabled: z.boolean().optional(),
  whatsappUrl: z.string().url().max(500).nullable().optional(),
  defaultBcc: z.string().email().max(200).nullable().optional(),
});

const reminderUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  delayMinutes: z.number().int().min(1).max(60 * 24 * 365),
  subject: z.string().trim().min(1).max(500),
  bodyHtml: z.string().min(1).max(20_000),
  bcc: z.string().email().max(200).nullable().optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const reminderIdSchema = z.object({ id: z.string().min(1) });

export const adminMarketingRouter = createAdminRouter({
  overview: staffProcedure.query(() => getMarketingOverview()),

  saveConfig: supportAdminProcedure
    .input(configUpdateSchema)
    .mutation(async ({ input }) => {
      await saveMarketingConfig(input);
      return { ok: true };
    }),

  // ─── Retargeting ────────────────────────────────────────────
  listRetargetReminders: staffProcedure.query(() =>
    prisma.retargetReminder.findMany({ orderBy: { sortOrder: 'asc' } }),
  ),
  saveRetargetReminder: supportAdminProcedure
    .input(reminderUpsertSchema)
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      if (id) {
        await prisma.retargetReminder.update({ where: { id }, data });
        return { id };
      }
      const row = await prisma.retargetReminder.create({ data });
      return { id: row.id };
    }),
  deleteRetargetReminder: supportAdminProcedure
    .input(reminderIdSchema)
    .mutation(async ({ input }) => {
      await prisma.retargetReminder.delete({ where: { id: input.id } });
      return { ok: true };
    }),
  toggleRetargetReminder: supportAdminProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await prisma.retargetReminder.update({
        where: { id: input.id },
        data: { enabled: input.enabled },
      });
      return { ok: true };
    }),
  runRetargetingNow: supportAdminProcedure.mutation(() => runRetargeting()),

  // ─── Cart recovery ──────────────────────────────────────────
  listCartReminders: staffProcedure.query(() =>
    prisma.cartRecoveryReminder.findMany({ orderBy: { sortOrder: 'asc' } }),
  ),
  saveCartReminder: supportAdminProcedure
    .input(reminderUpsertSchema)
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      if (id) {
        await prisma.cartRecoveryReminder.update({ where: { id }, data });
        return { id };
      }
      const row = await prisma.cartRecoveryReminder.create({ data });
      return { id: row.id };
    }),
  deleteCartReminder: supportAdminProcedure
    .input(reminderIdSchema)
    .mutation(async ({ input }) => {
      await prisma.cartRecoveryReminder.delete({ where: { id: input.id } });
      return { ok: true };
    }),
  toggleCartReminder: supportAdminProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await prisma.cartRecoveryReminder.update({
        where: { id: input.id },
        data: { enabled: input.enabled },
      });
      return { ok: true };
    }),
  runCartRecoveryNow: supportAdminProcedure.mutation(() => runCartRecovery()),

  listOpenCarts: staffProcedure.query(async () => {
    const rows = await prisma.checkoutOrder.findMany({
      where: {
        paidAt: null,
        status: { in: ['DRAFT', 'PENDING', 'FAILED'] },
      },
      select: {
        id: true,
        customerEmail: true,
        customerFirstName: true,
        planName: true,
        volumeMessages: true,
        billingCycle: true,
        amountCents: true,
        currency: true,
        createdAt: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows;
  }),
});
