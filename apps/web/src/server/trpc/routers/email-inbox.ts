import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { InboundEmailMatch, withTenant } from '@getyn/db';

import { createTRPCRouter, tenantProcedure } from '../trpc';

/**
 * Phase 8 M1 — /t/[slug]/email-inbox tRPC.
 *
 * Diagnostic surface: list InboundEmail rows for the tenant, filter
 * by matched-state, drill into one to see the raw payload.
 *
 * The Email Agent's approval inbox (M5) is a different surface —
 * this is the plumbing view.
 */

const listInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(25),
  filter: z
    .enum([
      'ALL',
      'UNMATCHED',
      'CAMPAIGN_SEND',
      'AGENT_ENROLLMENT',
      'AUTOMATION_ENROLLMENT',
    ])
    .default('ALL'),
});

export const emailInboxRouter = createTRPCRouter({
  list: tenantProcedure.input(listInputSchema).query(async ({ ctx, input }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.inboundEmail.findMany({
        where: {
          tenantId,
          ...(input.filter !== 'ALL'
            ? {
                matchedTo:
                  InboundEmailMatch[
                    input.filter as keyof typeof InboundEmailMatch
                  ],
              }
            : {}),
        },
        select: {
          id: true,
          fromAddress: true,
          fromName: true,
          toAddress: true,
          subject: true,
          matchedTo: true,
          processedAt: true,
          processError: true,
          receivedAt: true,
        },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const next = rows.pop();
        nextCursor = next?.id ?? null;
      }
      return { items: rows, nextCursor };
    });
  }),

  get: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.inboundEmail.findFirst({
          where: { id: input.id, tenantId },
          include: {
            campaignSend: {
              select: {
                id: true,
                campaignId: true,
                campaign: { select: { name: true } },
              },
            },
          },
        });
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        return row;
      });
    }),
});
