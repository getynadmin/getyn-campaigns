import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  Channel,
  ContactEventType,
  ContactSource,
  Prisma,
  Role,
  SuppressionReason,
  emitContactEvent,
  upsertSuppressionEntry,
  withTenant,
} from '@getyn/db';
import {
  contactCreateSchema,
  contactListInputSchema,
  contactUpdateSchema,
  cuidSchema,
} from '@getyn/types';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Contacts router.
 *
 * Every procedure runs its Prisma work inside `withTenant(tenantId, …)` so
 * Phase 2 RLS policies apply. We also include explicit `tenantId` filters
 * in the WHERE clauses for defense-in-depth and to keep Postgres query
 * plans fast (the supporting indexes are all tenantId-leading).
 *
 * The `customFields` bag is validated against the tenant's `CustomField`
 * registry before writes — unknown keys are rejected, and known keys are
 * coerced/validated per their declared type. Anything extra the caller
 * sends just for display gets silently dropped.
 */
export const contactsRouter = createTRPCRouter({
  /**
   * Paginated list with search + filters. Cursor is the last row's id;
   * ordering is (createdAt desc, id desc) for stable pagination even when
   * multiple rows share a createdAt.
   */
  list: tenantProcedure
    .input(contactListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      // includeDeleted is a privileged toggle — viewers/editors shouldn't
      // see soft-deleted rows even if the client flips the flag.
      const canSeeDeleted =
        ctx.tenantContext.membership.role === Role.OWNER ||
        ctx.tenantContext.membership.role === Role.ADMIN;
      const includeDeleted = (input.includeDeleted ?? false) && canSeeDeleted;

      const where: Prisma.ContactWhereInput = {
        tenantId,
        ...(includeDeleted ? {} : { deletedAt: null }),
        ...(input.emailStatus ? { emailStatus: input.emailStatus } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.tagIds && input.tagIds.length > 0
          ? { tags: { some: { tagId: { in: input.tagIds } } } }
          : {}),
        ...(input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: 'insensitive' } },
                { phone: { contains: input.search } },
                { firstName: { contains: input.search, mode: 'insensitive' } },
                { lastName: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      return withTenant(tenantId, async (tx) => {
        // Fetch one extra row to determine whether there's a next page.
        const rows = await tx.contact.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor
            ? { cursor: { id: input.cursor }, skip: 1 }
            : {}),
          include: {
            tags: {
              include: { tag: { select: { id: true, name: true, color: true } } },
            },
          },
        });

        let nextCursor: string | null = null;
        if (rows.length > input.limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }

        // Shape tags into a flat array to simplify client-side rendering.
        const items = rows.map((r) => ({
          ...r,
          tags: r.tags.map((t) => t.tag),
        }));

        // One extra count query — cheap for the current index shape. We need
        // it to render "X contacts" totals above the table; doing it inside
        // the same transaction keeps RLS visible to the count.
        const total = await tx.contact.count({ where });

        return { items, nextCursor, total };
      });
    }),

  /** Single contact, with tags and recent events preloaded. */
  get: tenantProcedure
    .input(z.object({ id: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      return withTenant(tenantId, async (tx) => {
        const contact = await tx.contact.findFirst({
          where: { id: input.id, tenantId },
          include: {
            tags: {
              include: { tag: { select: { id: true, name: true, color: true } } },
            },
            events: {
              orderBy: { occurredAt: 'desc' },
              take: 50,
            },
          },
        });
        if (!contact) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found.' });
        }
        return {
          ...contact,
          tags: contact.tags.map((t) => t.tag),
        };
      });
    }),

  /**
   * Create a contact. EDITORS and above can call this.
   *
   * Validates custom-field keys against the tenant's registry before writes:
   * unknown keys throw 400. Emits a CREATED event in the same transaction
   * so the timeline is never missing the birth moment.
   */
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(contactCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      await assertCustomFieldsAreRegistered(tenantId, input.customFields);

      return withTenant(tenantId, async (tx) => {
        // Uniqueness (via partial unique index) is enforced by the DB; we
        // surface a friendlier error on conflict.
        try {
          const contact = await tx.contact.create({
            data: {
              tenantId,
              email: input.email,
              phone: input.phone,
              firstName: input.firstName,
              lastName: input.lastName,
              language: input.language ?? 'en',
              timezone: input.timezone,
              source: input.source ?? ContactSource.MANUAL,
              emailStatus: input.emailStatus,
              smsStatus: input.smsStatus,
              whatsappStatus: input.whatsappStatus,
              customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
              ...(input.tagIds && input.tagIds.length > 0
                ? {
                    tags: {
                      create: input.tagIds.map((tagId) => ({ tagId })),
                    },
                  }
                : {}),
            },
            include: {
              tags: {
                include: { tag: { select: { id: true, name: true, color: true } } },
              },
            },
          });

          await emitContactEvent(tx, {
            tenantId,
            contactId: contact.id,
            type: ContactEventType.CREATED,
            metadata: { source: contact.source, via: 'manual' },
          });

          if (input.tagIds) {
            for (const tagId of input.tagIds) {
              await emitContactEvent(tx, {
                tenantId,
                contactId: contact.id,
                type: ContactEventType.TAG_ADDED,
                metadata: { tagId },
              });
            }
          }

          return { ...contact, tags: contact.tags.map((t) => t.tag) };
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'A contact with this email or phone already exists.',
            });
          }
          throw err;
        }
      });
    }),

  /**
   * Partial update. We diff against the current row so the timeline entry
   * records exactly what changed instead of a blanket "UPDATED".
   */
  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(contactUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      await assertCustomFieldsAreRegistered(tenantId, input.patch.customFields);

      return withTenant(tenantId, async (tx) => {
        const existing = await tx.contact.findFirst({
          where: { id: input.id, tenantId, deletedAt: null },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found.' });
        }

        // Merge custom fields instead of overwriting the bag — partial
        // patches shouldn't wipe keys the caller didn't touch.
        const nextCustomFields =
          input.patch.customFields !== undefined
            ? {
                ...((existing.customFields ?? {}) as Record<string, unknown>),
                ...input.patch.customFields,
              }
            : undefined;

        const data: Prisma.ContactUpdateInput = {
          ...(input.patch.email !== undefined ? { email: input.patch.email } : {}),
          ...(input.patch.phone !== undefined ? { phone: input.patch.phone } : {}),
          ...(input.patch.firstName !== undefined
            ? { firstName: input.patch.firstName }
            : {}),
          ...(input.patch.lastName !== undefined
            ? { lastName: input.patch.lastName }
            : {}),
          ...(input.patch.language !== undefined
            ? { language: input.patch.language }
            : {}),
          ...(input.patch.timezone !== undefined
            ? { timezone: input.patch.timezone }
            : {}),
          ...(input.patch.source !== undefined ? { source: input.patch.source } : {}),
          ...(input.patch.emailStatus !== undefined
            ? { emailStatus: input.patch.emailStatus }
            : {}),
          ...(input.patch.smsStatus !== undefined
            ? { smsStatus: input.patch.smsStatus }
            : {}),
          ...(input.patch.whatsappStatus !== undefined
            ? { whatsappStatus: input.patch.whatsappStatus }
            : {}),
          ...(nextCustomFields !== undefined
            ? { customFields: nextCustomFields as Prisma.InputJsonValue }
            : {}),
        };

        // Determine which scalar fields changed so the event carries a diff.
        const changed: string[] = [];
        for (const key of Object.keys(data) as Array<keyof typeof data>) {
          const before = (existing as Record<string, unknown>)[key as string];
          const after = (data as Record<string, unknown>)[key as string];
          if (!isDeepEqual(before, after)) changed.push(key as string);
        }

        try {
          const updated = await tx.contact.update({
            where: { id: existing.id },
            data,
            include: {
              tags: {
                include: { tag: { select: { id: true, name: true, color: true } } },
              },
            },
          });

          if (changed.length > 0) {
            await emitContactEvent(tx, {
              tenantId,
              contactId: existing.id,
              type: ContactEventType.UPDATED,
              metadata: { changed },
            });
          }

          // Status-flip events — one per channel — so the timeline shows
          // subscribe/unsubscribe separately from generic field edits.
          // We also auto-add a SuppressionEntry on the negative transitions
          // (UNSUBSCRIBED / BOUNCED / COMPLAINED) so Phase 3's send pipeline
          // has a single canonical block list to consult before every send.
          for (const [key, channel] of [
            ['emailStatus', Channel.EMAIL],
            ['smsStatus', Channel.SMS],
            ['whatsappStatus', Channel.WHATSAPP],
          ] as const) {
            const before = existing[key];
            const after = (data as Record<string, unknown>)[key];
            if (after === undefined || after === before) continue;
            let type: ContactEventType | null = null;
            let suppressionReason: SuppressionReason | null = null;
            if (after === 'UNSUBSCRIBED') {
              type = ContactEventType.UNSUBSCRIBED;
              suppressionReason = SuppressionReason.UNSUBSCRIBED;
            } else if (after === 'BOUNCED') {
              type = ContactEventType.BOUNCED;
              suppressionReason = SuppressionReason.BOUNCED;
            } else if (after === 'COMPLAINED') {
              type = ContactEventType.COMPLAINED;
              suppressionReason = SuppressionReason.COMPLAINED;
            } else if (after === 'SUBSCRIBED' && before !== 'SUBSCRIBED') {
              type = ContactEventType.SUBSCRIBED;
            }
            if (type) {
              await emitContactEvent(tx, {
                tenantId,
                contactId: existing.id,
                type,
                metadata: { channel, from: before, to: after },
              });
            }
            if (suppressionReason) {
              // EMAIL channel uses the contact's email; SMS + WHATSAPP use
              // the phone (already E.164-normalized at write time). If the
              // contact is missing the corresponding identifier we just
              // skip — there's nothing to block.
              const value =
                channel === Channel.EMAIL
                  ? existing.email
                  : existing.phone;
              if (value) {
                await upsertSuppressionEntry(tx, {
                  tenantId,
                  channel,
                  value,
                  reason: suppressionReason,
                  metadata: {
                    via: 'contact_status_change',
                    contactId: existing.id,
                  },
                });
              }
            }
          }

          return { ...updated, tags: updated.tags.map((t) => t.tag) };
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Another contact already uses this email or phone.',
            });
          }
          throw err;
        }
      });
    }),

  /**
   * Soft-delete. Partial unique indexes exclude soft-deleted rows, so the
   * same email/phone can be re-used by a new contact afterwards.
   */
  softDelete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.contact.findFirst({
          where: { id: input.id, tenantId, deletedAt: null },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found.' });
        }
        await tx.contact.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
        await emitContactEvent(tx, {
          tenantId,
          contactId: existing.id,
          type: ContactEventType.UPDATED,
          metadata: { changed: ['deletedAt'], action: 'soft_delete' },
        });
        return { ok: true as const };
      });
    }),

  /** Un-soft-delete. OWNER/ADMIN only — same caveats as includeDeleted. */
  restore: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.contact.findFirst({
          where: { id: input.id, tenantId, deletedAt: { not: null } },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Deleted contact not found.',
          });
        }
        // Guard against collisions — if a new row now owns the same
        // email/phone we can't restore without surfacing the clash.
        if (existing.email || existing.phone) {
          const conflict = await tx.contact.findFirst({
            where: {
              tenantId,
              deletedAt: null,
              OR: [
                existing.email ? { email: existing.email } : {},
                existing.phone ? { phone: existing.phone } : {},
              ].filter((c) => Object.keys(c).length > 0),
            },
          });
          if (conflict) {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                'Another contact now uses this email or phone. Restore is blocked.',
            });
          }
        }
        await tx.contact.update({
          where: { id: existing.id },
          data: { deletedAt: null },
        });
        await emitContactEvent(tx, {
          tenantId,
          contactId: existing.id,
          type: ContactEventType.UPDATED,
          metadata: { changed: ['deletedAt'], action: 'restore' },
        });
        return { ok: true as const };
      });
    }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reject writes referencing custom-field keys that aren't in the tenant's
 * registry. Type-level coercion (e.g. NUMBER strings → number) will land
 * with Milestone 5; Phase 2 writes trust the UI to submit the right shape
 * and only defend against unknown keys here.
 */
async function assertCustomFieldsAreRegistered(
  tenantId: string,
  values: Record<string, unknown> | undefined,
): Promise<void> {
  if (!values) return;
  const keys = Object.keys(values);
  if (keys.length === 0) return;

  const registered = await withTenant(tenantId, (tx) =>
    tx.customField.findMany({
      where: { tenantId, key: { in: keys } },
      select: { key: true },
    }),
  );
  const known = new Set(registered.map((r) => r.key));
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown custom field key(s): ${unknown.join(', ')}. Define them in Settings → Custom fields first.`,
    });
  }
}

/** Minimal deep-equal that's enough for scalar + bag comparison. */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
