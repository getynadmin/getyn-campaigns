import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@getyn/db';

import { createTRPCRouter, tenantProcedure } from '../trpc';

/**
 * In-app notifications. A row with `userId = null` is tenant-wide;
 * every member sees it. A row with `userId` set is personal to that
 * user. `list` returns both kinds (the user's own + tenant-wide),
 * ordered by createdAt desc.
 */
export const notificationsRouter = createTRPCRouter({
  list: tenantProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const { tenant } = ctx.tenantContext;
      const items = await prisma.notification.findMany({
        where: {
          tenantId: tenant.id,
          OR: [{ userId: null }, { userId: ctx.user.id }],
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
      return items;
    }),

  unreadCount: tenantProcedure.query(async ({ ctx }) => {
    const { tenant } = ctx.tenantContext;
    const count = await prisma.notification.count({
      where: {
        tenantId: tenant.id,
        readAt: null,
        OR: [{ userId: null }, { userId: ctx.user.id }],
      },
    });
    return { count };
  }),

  markRead: tenantProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { tenant } = ctx.tenantContext;
      const row = await prisma.notification.findFirst({
        where: {
          id: input.id,
          tenantId: tenant.id,
          OR: [{ userId: null }, { userId: ctx.user.id }],
        },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (!row.readAt) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { readAt: new Date() },
        });
      }
      return { ok: true };
    }),

  markAllRead: tenantProcedure.mutation(async ({ ctx }) => {
    const { tenant } = ctx.tenantContext;
    await prisma.notification.updateMany({
      where: {
        tenantId: tenant.id,
        readAt: null,
        OR: [{ userId: null }, { userId: ctx.user.id }],
      },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }),
});
