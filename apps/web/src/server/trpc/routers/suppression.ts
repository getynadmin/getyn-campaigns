import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Prisma } from '@getyn/db';
import {
  Channel,
  Role,
  SuppressionReason,
  upsertSuppressionEntry,
  withTenant,
} from '@getyn/db';
import {
  cuidSchema,
  suppressionCreateSchema,
  suppressionListInputSchema,
} from '@getyn/types';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Suppression list router.
 *
 * The list is the canonical "do not contact" set Phase 3's send pipeline
 * will consult before every send. Most rows arrive automatically from
 * `contacts.update` when a status flips to UNSUBSCRIBED / BOUNCED /
 * COMPLAINED — this router exposes:
 *
 *  - `list`   — paginated browse with channel/reason/search filters,
 *  - `create` — manual block (admin pastes an email/phone),
 *  - `delete` — remove a row (does NOT auto-resubscribe the matching contact;
 *               that's an explicit Contact edit and is left as a follow-up
 *               action so a slip of the finger here doesn't restart sends).
 *
 * Mutations are gated to OWNER/ADMIN — viewers and editors can browse the
 * list but not modify it. This matches the privacy-shaped operations:
 * removing a suppression entry is the kind of thing we want to keep
 * accountable.
 */
export const suppressionRouter = createTRPCRouter({
  list: tenantProcedure
    .input(suppressionListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const where: Prisma.SuppressionEntryWhereInput = {
        tenantId,
        ...(input.channel ? { channel: input.channel } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.search
          ? {
              value: { contains: input.search, mode: 'insensitive' },
            }
          : {}),
      };
      return withTenant(tenantId, async (tx) => {
        const rows = await tx.suppressionEntry.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor
            ? { cursor: { id: input.cursor }, skip: 1 }
            : {}),
        });
        let nextCursor: string | null = null;
        if (rows.length > input.limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }
        // Total count is cheap with the supporting index — drives the
        // "1,234 suppressed" badge at the top of the list page.
        const total = await tx.suppressionEntry.count({ where });
        return { items: rows, nextCursor, total };
      });
    }),

  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(suppressionCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      // Light shape validation per channel — the Zod schema accepts any
      // string so we don't try to do strict E.164 here, but a value that
      // doesn't even look like an email when the channel is EMAIL is
      // almost certainly a paste error.
      if (input.channel === Channel.EMAIL && !input.value.includes('@')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Email addresses must contain "@".',
        });
      }

      return withTenant(tenantId, async (tx) => {
        const result = await upsertSuppressionEntry(tx, {
          tenantId,
          channel: input.channel,
          value: input.value,
          reason: SuppressionReason.MANUAL,
          metadata: input.note ? { note: input.note } : {},
        });
        if (result === 'noop') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This address is already suppressed.',
          });
        }
        // Re-fetch so the client gets the full row (including createdAt).
        const row = await tx.suppressionEntry.findUnique({
          where: {
            tenantId_channel_value: {
              tenantId,
              channel: input.channel,
              value: input.value,
            },
          },
        });
        return row!;
      });
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.suppressionEntry.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Suppression entry not found.',
          });
        }
        await tx.suppressionEntry.delete({ where: { id: existing.id } });
        return { ok: true as const };
      });
    }),
});
