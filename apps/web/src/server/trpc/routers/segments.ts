import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Prisma } from '@getyn/db';
import { Role, withTenant } from '@getyn/db';
import {
  cuidSchema,
  segmentCreateSchema,
  segmentListInputSchema,
  segmentPreviewSchema,
  segmentRulesSchema,
  segmentUpdateSchema,
  type SegmentRules,
} from '@getyn/types';

import {
  SegmentCompileError,
  compileSegmentRules,
  type SegmentCustomFieldEntry,
} from '@getyn/db';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Segments router.
 *
 * A Segment is a saved predicate over Contact (stored as a validated rule
 * tree in `Segment.rules`). The rule tree is compiled at read time into a
 * Prisma WhereInput by `compileSegmentRules` — we never persist the compiled
 * form, only the source tree, so that schema evolution (e.g. renaming a
 * CustomField key) remains non-destructive.
 *
 * Every query/mutation runs inside `withTenant` so Phase 2 RLS applies. We
 * also include an explicit `tenantId` filter in every WHERE for
 * defense-in-depth and for the indexes on `(tenantId, …)` to be picked up.
 *
 * `cachedCount` / `cachedCountAt` are best-effort. The UI displays them on
 * the list page so it doesn't pay the cost of a COUNT(*) per row. They're
 * refreshed on:
 *   - create / update (inline)
 *   - explicit `recomputeCount` call (for the detail page's "Refresh" button)
 * Background worker refresh can land later; for now staleness is acceptable.
 */

/**
 * Resolve the tenant's custom-field registry to what the compiler expects.
 * Centralised so list/get/preview/recomputeCount all behave identically.
 */
async function loadCustomFieldEntries(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<SegmentCustomFieldEntry[]> {
  const rows = await tx.customField.findMany({
    where: { tenantId },
    select: { id: true, key: true, type: true },
  });
  return rows.map((r) => ({ id: r.id, key: r.key, type: r.type }));
}

/**
 * Shared: compile + count a rule tree against Contact. Throws TRPCError with
 * a precise BAD_REQUEST when the compiler rejects the tree (e.g. a renamed
 * CustomField ref), so the client can surface a helpful message.
 */
async function compileAndCount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rules: SegmentRules,
): Promise<{ where: Prisma.ContactWhereInput; count: number }> {
  const customFields = await loadCustomFieldEntries(tx, tenantId);
  let compiled: Prisma.ContactWhereInput;
  try {
    compiled = compileSegmentRules(rules, { customFields });
  } catch (err) {
    if (err instanceof SegmentCompileError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
    }
    throw err;
  }
  const where: Prisma.ContactWhereInput = {
    AND: [{ tenantId, deletedAt: null }, compiled],
  };
  const count = await tx.contact.count({ where });
  return { where, count };
}

export const segmentsRouter = createTRPCRouter({
  /**
   * List segments — newest first. Returns the cached count so the sidebar
   * badge can render without running N counts.
   */
  list: tenantProcedure
    .input(segmentListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const rows = await tx.segment.findMany({
          where: { tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor
            ? { cursor: { id: input.cursor }, skip: 1 }
            : {}),
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        });
        let nextCursor: string | null = null;
        if (rows.length > input.limit) {
          const next = rows.pop();
          nextCursor = next?.id ?? null;
        }
        return { items: rows, nextCursor };
      });
    }),

  /**
   * Fetch one segment. The rule tree is returned verbatim — the rule-builder
   * UI re-hydrates from it. We deliberately don't run a fresh count here to
   * keep this query cheap; the detail page triggers `recomputeCount` if it
   * wants a fresh number.
   */
  get: tenantProcedure
    .input(z.object({ id: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const segment = await tx.segment.findFirst({
          where: { id: input.id, tenantId },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        });
        if (!segment) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found.',
          });
        }
        // Re-parse the stored rules to catch drift: if someone mutated the
        // JSON by hand, we should fail loudly before handing it to the UI.
        const parsed = segmentRulesSchema.safeParse(segment.rules);
        if (!parsed.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Segment rules are in an unexpected shape.',
          });
        }
        return { ...segment, rules: parsed.data };
      });
    }),

  /**
   * Create a segment. Validates the rule tree, compiles it (which surfaces
   * nice errors for stale custom-field refs, etc.), then stores + caches the
   * initial count in a single transaction.
   */
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(segmentCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const { count } = await compileAndCount(tx, tenantId, input.rules);
        const now = new Date();
        return tx.segment.create({
          data: {
            tenantId,
            name: input.name,
            description: input.description ?? null,
            rules: input.rules as unknown as Prisma.InputJsonValue,
            cachedCount: count,
            cachedCountAt: now,
            createdByUserId: ctx.user.id,
          },
        });
      });
    }),

  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(segmentUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.segment.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found.',
          });
        }

        // If the rule tree changed, recompute the count in the same TX so
        // we don't leave a stale cachedCount pointing at the old tree.
        let countPatch: { cachedCount: number; cachedCountAt: Date } | null = null;
        if (input.rules) {
          const { count } = await compileAndCount(tx, tenantId, input.rules);
          countPatch = { cachedCount: count, cachedCountAt: new Date() };
        }

        return tx.segment.update({
          where: { id: existing.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.rules
              ? { rules: input.rules as unknown as Prisma.InputJsonValue }
              : {}),
            ...(countPatch ?? {}),
          },
        });
      });
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.segment.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found.',
          });
        }
        await tx.segment.delete({ where: { id: existing.id } });
        return { ok: true as const };
      });
    }),

  /**
   * Force a fresh count + cache update. Used by the "Refresh" button on the
   * detail page. Returns the new count so the UI doesn't need a follow-up
   * fetch.
   */
  recomputeCount: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.segment.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, rules: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Segment not found.',
          });
        }
        const parsed = segmentRulesSchema.safeParse(existing.rules);
        if (!parsed.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Segment rules are in an unexpected shape.',
          });
        }
        const { count } = await compileAndCount(tx, tenantId, parsed.data);
        const now = new Date();
        await tx.segment.update({
          where: { id: existing.id },
          data: { cachedCount: count, cachedCountAt: now },
        });
        return { count, cachedCountAt: now };
      });
    }),

  /**
   * Preview: compile + count + return a small sample without persisting. The
   * rule builder's "Preview" button uses this to show "matches 4,321 contacts"
   * and a few example rows while the user is still editing. Rate-limited by
   * the small sampleSize cap in the schema (≤25).
   */
  preview: tenantProcedure
    .input(segmentPreviewSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const { where, count } = await compileAndCount(
          tx,
          tenantId,
          input.rules,
        );
        const sample =
          input.sampleSize > 0
            ? await tx.contact.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: input.sampleSize,
                select: {
                  id: true,
                  email: true,
                  phone: true,
                  firstName: true,
                  lastName: true,
                  emailStatus: true,
                  createdAt: true,
                },
              })
            : [];
        return { count, sample };
      });
    }),
});
