import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { Role, WAStatus, withTenant } from '@getyn/db';
import type { WATemplateStatus } from '@getyn/db';
import { syncTemplatesForWaba } from '@getyn/whatsapp';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * WhatsAppTemplate router — Phase 4 M5 (read + manual sync only).
 *
 * Authoring lands in M6; AI drafting in M7. Today's surface:
 *   - list: paginated browse, optional status / category filter
 *   - get: one template with full components Json
 *   - syncNow: manual trigger (rate-limited per WABA, OWNER+ADMIN)
 *
 * Cursor pagination follows the Phase 2/3 pattern.
 */

const TEMPLATE_LIST_LIMIT_DEFAULT = 50;
const TEMPLATE_LIST_LIMIT_MAX = 100;
const SYNC_RATE_LIMIT_SECONDS = 30;

const templateListInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(TEMPLATE_LIST_LIMIT_MAX).optional(),
  status: z
    .enum([
      'DRAFT',
      'PENDING',
      'APPROVED',
      'REJECTED',
      'PAUSED',
      'DISABLED',
    ])
    .optional(),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
  language: z.string().min(2).max(10).optional(),
});

const templateIdSchema = z.object({ id: z.string().min(1).max(64) });

export const whatsAppTemplatesRouter = createTRPCRouter({
  list: tenantProcedure
    .input(templateListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const limit = input.limit ?? TEMPLATE_LIST_LIMIT_DEFAULT;

      return withTenant(tenantId, async (tx) => {
        const where = {
          tenantId,
          deletedAt: null,
          ...(input.status ? { status: input.status as WATemplateStatus } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.language ? { language: input.language } : {}),
        };
        const rows = await tx.whatsAppTemplate.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        let nextCursor: string | null = null;
        if (rows.length > limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }
        const total = await tx.whatsAppTemplate.count({ where });
        return { items: rows, nextCursor, total };
      });
    }),

  get: tenantProcedure
    .input(templateIdSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.findFirst({
          where: { id: input.id, tenantId, deletedAt: null },
        }),
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found.',
        });
      }
      return row;
    }),

  /**
   * Manual sync. Hits Meta + reconciles WhatsAppTemplate rows.
   * Rate-limited per-WABA via the account's `updatedAt` to keep
   * tenants from spamming Meta. The hourly cron in apps/worker
   * runs this same path for every CONNECTED WABA.
   */
  syncNow: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .mutation(async ({ ctx }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const account = await withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.findUnique({ where: { tenantId } }),
      );
      if (!account) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Connect a WhatsApp account first.',
        });
      }
      if (account.status !== WAStatus.CONNECTED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Reconnect the WhatsApp account first.',
        });
      }

      // Rate-limit on the account's updatedAt — touched by every
      // sync via Prisma's @updatedAt.
      const wait =
        SYNC_RATE_LIMIT_SECONDS * 1000 -
        (Date.now() - account.updatedAt.getTime());
      if (wait > 0) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Synced too recently. Try again in ${Math.ceil(wait / 1000)}s.`,
        });
      }

      try {
        const summary = await withTenant(tenantId, async (tx) => {
          const result = await syncTemplatesForWaba(account, tx);
          // Touch the account so the rate-limit ticks.
          await tx.whatsAppAccount.update({
            where: { id: account.id },
            data: { updatedAt: new Date() },
          });
          return result;
        });
        return summary;
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            err instanceof Error ? `Sync failed: ${err.message}` : 'Sync failed.',
          cause: err,
        });
      }
    }),
});
