import { TRPCError } from '@trpc/server';

import { withTenant } from '@getyn/db';
import { contactEventListInputSchema } from '@getyn/types';

import { createTRPCRouter, tenantProcedure } from '../trpc';

/**
 * Contact events router — paginated activity timeline reads.
 *
 * `contacts.get` already returns the most-recent 50 events for the side
 * card on first paint, but the detail page wants a "Load more" button and
 * the contact may have hundreds of rows over time. This router serves that:
 * cursor-paginated, ordered by `(occurredAt desc, id desc)` so collisions
 * on `occurredAt` (likely with our `@default(now())`) still paginate
 * deterministically.
 *
 * The `contacts.events` index `(tenantId, contactId, occurredAt desc)` covers
 * this query; explicit `tenantId` in the WHERE keeps Postgres on that index
 * even though RLS already constrains visibility.
 */
export const eventsRouter = createTRPCRouter({
  list: tenantProcedure
    .input(contactEventListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        // Confirm the contact lives in this tenant before serving events.
        // RLS would block cross-tenant reads anyway, but a 404 is a nicer
        // failure mode than a silently empty list.
        const exists = await tx.contact.findFirst({
          where: { id: input.contactId, tenantId },
          select: { id: true },
        });
        if (!exists) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Contact not found.',
          });
        }
        const rows = await tx.contactEvent.findMany({
          where: { tenantId, contactId: input.contactId },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
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
        return { items: rows, nextCursor };
      });
    }),
});
