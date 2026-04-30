import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { decrypt, type EncryptedField } from '@getyn/crypto';
import {
  Role,
  WAStatus,
  WATemplateStatus,
  withTenant,
  type Prisma,
} from '@getyn/db';
import {
  validateForCategory,
  whatsAppTemplateCreateSchema,
  whatsAppTemplateDeleteSchema,
  whatsAppTemplateDuplicateSchema,
  whatsAppTemplateSubmitSchema,
  whatsAppTemplateUpdateSchema,
} from '@getyn/types';
import {
  MetaApiError,
  createMessageTemplate,
  deleteMessageTemplate,
  syncTemplatesForWaba,
} from '@getyn/whatsapp';

import { enqueuePollTemplateSubmission } from '@/server/queues';

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

  // --------------------------------------------------------------------------
  // M6 — authoring
  // --------------------------------------------------------------------------

  /**
   * Create a local DRAFT. Schema validation already covers structural
   * + variable rules; we additionally surface editorial issues
   * (banned phrases, AUTH constraints) as a warning array — the UI
   * shows them as soft warnings rather than blocking save.
   *
   * Idempotency: rejects if (whatsAppAccountId, name, language) already
   * exists for a non-deleted row. Use duplicate to create a versioned
   * variant.
   */
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppTemplateCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      const account = await withTenant(tenantId, (tx) =>
        tx.whatsAppAccount.findUnique({ where: { tenantId } }),
      );
      if (!account) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Connect a WhatsApp account first.',
        });
      }

      const editorialIssues = validateForCategory(input);

      try {
        const created = await withTenant(tenantId, (tx) =>
          tx.whatsAppTemplate.create({
            data: {
              tenantId,
              whatsAppAccountId: account.id,
              name: input.name,
              language: input.language,
              category: input.category,
              status: WATemplateStatus.DRAFT,
              components: input.components as unknown as Prisma.JsonArray,
              createdByUserId: userId,
            },
          }),
        );
        return { template: created, editorialIssues };
      } catch (err) {
        // Partial-unique conflict — Postgres raises 23505 on the
        // partial index over (whatsAppAccountId, name, language).
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'A template with that name + language already exists. Pick a new name or duplicate the existing one.',
          });
        }
        throw err;
      }
    }),

  /**
   * Update — DRAFT only. Anything else: tell the user to duplicate.
   * The patch shape is partial; fields not in the patch are left as-is.
   */
  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppTemplateUpdateSchema)
    .mutation(async ({ ctx, input }) => {
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
      if (row.status !== WATemplateStatus.DRAFT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Meta does not allow editing of submitted templates. Duplicate this template to create a new draft.',
        });
      }

      const data: Prisma.WhatsAppTemplateUpdateInput = {};
      if (input.patch.name !== undefined) data.name = input.patch.name;
      if (input.patch.language !== undefined) data.language = input.patch.language;
      if (input.patch.category !== undefined) data.category = input.patch.category;
      if (input.patch.components !== undefined) {
        data.components = input.patch.components as unknown as Prisma.JsonArray;
      }

      try {
        const updated = await withTenant(tenantId, (tx) =>
          tx.whatsAppTemplate.update({ where: { id: row.id }, data }),
        );
        return updated;
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Another template with that name + language already exists.',
          });
        }
        throw err;
      }
    }),

  /**
   * Submit DRAFT to Meta. Atomically:
   *   1. Re-validate (defence against client tampering)
   *   2. POST to Meta's create-template endpoint
   *   3. Stamp metaTemplateId + status=PENDING + submittedAt
   *   4. Enqueue the poll-submission chain so the UI sees status
   *      transitions within ~30s instead of waiting for the hourly tick
   */
  submit: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppTemplateSubmitSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      const row = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.findFirst({
          where: { id: input.id, tenantId, deletedAt: null },
          include: { whatsAppAccount: true },
        }),
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found.',
        });
      }
      if (row.status !== WATemplateStatus.DRAFT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Only DRAFT templates can be submitted. Duplicate this template to create a new draft.',
        });
      }
      if (row.whatsAppAccount.status !== WAStatus.CONNECTED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Reconnect the WhatsApp account first.',
        });
      }

      const accessToken = decrypt(
        row.whatsAppAccount.accessTokenEncrypted as unknown as EncryptedField,
        tenantId,
      );

      let metaResp;
      try {
        metaResp = await createMessageTemplate(
          row.whatsAppAccount.wabaId,
          accessToken,
          {
            name: row.name,
            language: row.language,
            category: row.category,
            components: row.components as unknown[],
          },
        );
      } catch (err) {
        if (err instanceof MetaApiError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Meta rejected the template: ${err.message}${err.metaCode ? ` (code ${err.metaCode})` : ''}`,
            cause: err,
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Submission failed.',
          cause: err,
        });
      }

      const updated = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.update({
          where: { id: row.id },
          data: {
            metaTemplateId: metaResp.id,
            status: WATemplateStatus.PENDING,
            submittedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        }),
      );

      // Fire-and-forget the poll chain. Failure to enqueue is non-fatal
      // because the hourly tick will still pick the template up.
      try {
        await enqueuePollTemplateSubmission({
          templateId: row.id,
          tenantId,
          attempt: 0,
        });
      } catch (err) {
        // Non-fatal — log via console; Sentry will see worker enqueue
        // failures via the sentry wrap on the BullMQ worker `failed` event.
        console.warn(
          `[whatsAppTemplate.submit] enqueue poll failed (template=${row.id}):`,
          err instanceof Error ? err.message : err,
        );
      }

      return updated;
    }),

  /**
   * Soft-delete. Blocked when a non-DRAFT campaign references the
   * template — those campaigns may already have queued sends pointing
   * at this row.
   *
   * If the template was submitted to Meta, we also call the Meta
   * delete endpoint so the WABA stays in sync. Meta failures don't
   * block the soft-delete (the template is unusable from our side
   * anyway after the local row gets deletedAt).
   */
  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(whatsAppTemplateDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      const row = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.findFirst({
          where: { id: input.id, tenantId, deletedAt: null },
          include: { whatsAppAccount: true },
        }),
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found.',
        });
      }

      // Block if any non-DRAFT campaign references it.
      const refCount = await withTenant(tenantId, (tx) =>
        tx.whatsAppCampaign.count({
          where: {
            templateId: row.id,
            campaign: { status: { not: 'DRAFT' } },
          },
        }),
      );
      if (refCount > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete — ${refCount} non-draft campaign(s) reference this template.`,
        });
      }

      // Best-effort Meta delete. Wrapped so a Meta blip doesn't block
      // the local soft-delete.
      if (row.metaTemplateId && row.whatsAppAccount.status === WAStatus.CONNECTED) {
        try {
          const accessToken = decrypt(
            row.whatsAppAccount.accessTokenEncrypted as unknown as EncryptedField,
            tenantId,
          );
          await deleteMessageTemplate(
            row.whatsAppAccount.wabaId,
            accessToken,
            { name: row.name, hsmId: row.metaTemplateId },
          );
        } catch (err) {
          console.warn(
            `[whatsAppTemplate.delete] Meta delete failed for ${row.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      const deleted = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        }),
      );
      return { ok: true as const, id: deleted.id };
    }),

  /**
   * Duplicate — clone any template (any status) as a fresh DRAFT.
   * Used as the "edit approved" entry point: Meta forbids editing,
   * so the UI offers duplicate-as-draft instead.
   *
   * `newName` defaults to `${original}_v2`, with `_v3`, `_v4`, ...
   * if `_v2` already exists.
   */
  duplicate: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(whatsAppTemplateDuplicateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const userId = ctx.user.id;

      const source = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.findFirst({
          where: { id: input.id, tenantId, deletedAt: null },
        }),
      );
      if (!source) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found.',
        });
      }

      const baseName = input.newName ?? incrementName(source.name);
      const newName = await withTenant(tenantId, async (tx) => {
        let candidate = baseName;
        let i = 0;
        while (i < 20) {
          const exists = await tx.whatsAppTemplate.findFirst({
            where: {
              whatsAppAccountId: source.whatsAppAccountId,
              name: candidate,
              language: source.language,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!exists) return candidate;
          i += 1;
          candidate = incrementName(candidate);
        }
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Could not find an unused name; pass `newName` explicitly.',
        });
      });

      const dup = await withTenant(tenantId, (tx) =>
        tx.whatsAppTemplate.create({
          data: {
            tenantId,
            whatsAppAccountId: source.whatsAppAccountId,
            name: newName,
            language: source.language,
            category: source.category,
            status: WATemplateStatus.DRAFT,
            components: source.components as unknown as Prisma.JsonArray,
            createdByUserId: userId,
          },
        }),
      );
      return dup;
    }),
});

/**
 * Bump `_vN` suffix or append `_v2`. Used by duplicate to find an
 * unused name without forcing the caller to think about versioning.
 *
 *   "order_shipped"     → "order_shipped_v2"
 *   "order_shipped_v2"  → "order_shipped_v3"
 *   "x_v17"             → "x_v18"
 */
function incrementName(name: string): string {
  const m = name.match(/^(.+?)_v(\d+)$/);
  if (m && m[1] && m[2]) {
    return `${m[1]}_v${Number.parseInt(m[2], 10) + 1}`;
  }
  return `${name}_v2`;
}
