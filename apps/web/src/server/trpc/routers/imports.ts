import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { ImportJobStatus, Role, withTenant } from '@getyn/db';
import type { Prisma } from '@getyn/db';
import {
  cuidSchema,
  importListInputSchema,
  importRequestUploadSchema,
  importStartSchema,
} from '@getyn/types';

import { getSupabaseAdmin } from '@/server/auth/supabase-admin';
import { enqueueImportJob } from '@/server/queues';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

const IMPORT_BUCKET = 'imports';

/**
 * Imports router — drives the CSV import wizard.
 *
 * Flow:
 *   1. `requestUpload` — mint a signed Supabase Storage URL under the
 *      tenant's own folder. The user's browser PUTs the file directly to
 *      Storage (no byte ever touches our Node process).
 *   2. `start` — user has mapped columns + chosen defaults + tags. We
 *      create the ImportJob row (PENDING) and enqueue one BullMQ job.
 *   3. `get` / `list` — UI polls `get` until status is terminal. `list`
 *      feeds the history panel on the contacts import page.
 *   4. `cancel` — flip status to CANCELED. The worker re-checks status
 *      before every batch so in-flight jobs stop at the next checkpoint.
 *
 * Defense-in-depth: we never trust the `storagePath` the client sends to
 * `start`. We re-parse it and confirm it starts with the caller's tenant
 * id (Supabase Storage's RLS policy enforces the same thing, but the
 * failure mode is cleaner when the server rejects early).
 */
export const importsRouter = createTRPCRouter({
  /**
   * Issue a signed upload URL for the `imports` bucket. The path is
   * `{tenantId}/{uuid}.csv` so the tenant-scoped RLS policy on Storage
   * accepts the write. We return both the signed URL and the server-chosen
   * path; the client sends the path back on `start`.
   */
  requestUpload: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(importRequestUploadSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const storagePath = `${tenantId}/${randomUUID()}.csv`;

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase.storage
        .from(IMPORT_BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Could not create upload URL: ${error?.message ?? 'unknown error'}`,
        });
      }

      return {
        storagePath,
        fileName: input.fileName,
        uploadUrl: data.signedUrl,
        token: data.token,
        bucket: IMPORT_BUCKET,
      };
    }),

  /**
   * Create the ImportJob row and enqueue the worker. Returns the job id so
   * the wizard can redirect to the progress page.
   *
   * If enqueue fails (Redis unreachable), the ImportJob is left in PENDING;
   * a follow-up manual retry can re-enqueue. We chose not to mark it FAILED
   * here because the failure is transient infrastructure, not user input.
   */
  start: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(importStartSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      // Storage path sanity — it must live under this tenant's folder.
      if (!input.storagePath.startsWith(`${tenantId}/`)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Upload path does not belong to this workspace.',
        });
      }

      // Best-effort validation: custom-field ids referenced by the mapping
      // must exist for this tenant. Catches stale mappings from a tab that
      // was open while another admin deleted a field.
      const customFieldIds = new Set<string>();
      for (const entry of Object.values(input.mapping)) {
        if (entry.kind === 'custom_field') customFieldIds.add(entry.customFieldId);
      }
      if (customFieldIds.size > 0) {
        const found = await withTenant(tenantId, (tx) =>
          tx.customField.findMany({
            where: { tenantId, id: { in: Array.from(customFieldIds) } },
            select: { id: true },
          }),
        );
        if (found.length !== customFieldIds.size) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'One or more mapped custom fields no longer exist. Reload the page and remap.',
          });
        }
      }

      // Tag ids must also belong to the tenant — cheap tenancy check.
      if (input.tagIds && input.tagIds.length > 0) {
        const found = await withTenant(tenantId, (tx) =>
          tx.tag.findMany({
            where: { tenantId, id: { in: input.tagIds } },
            select: { id: true },
          }),
        );
        if (found.length !== input.tagIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more tags no longer exist.',
          });
        }
      }

      const job = await withTenant(tenantId, (tx) =>
        tx.importJob.create({
          data: {
            tenantId,
            status: ImportJobStatus.PENDING,
            fileName: input.fileName,
            storagePath: input.storagePath,
            mapping: input.mapping as unknown as Prisma.InputJsonValue,
            tagIds: input.tagIds ?? [],
            defaultEmailStatus: input.defaultEmailStatus,
            defaultSmsStatus: input.defaultSmsStatus,
            defaultWhatsappStatus: input.defaultWhatsappStatus,
            dedupeBy: input.dedupeBy,
            createdByUserId: ctx.user.id,
          },
          select: { id: true },
        }),
      );

      // Enqueue outside the transaction — we don't want Redis hiccups to
      // roll back a committed ImportJob row.
      try {
        await enqueueImportJob({ importJobId: job.id, tenantId });
      } catch (err) {
        // Leave the job PENDING so a re-enqueue (once Redis is back) can
        // pick it up. Surface the error to the caller so the UI can warn.
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Could not enqueue import: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        });
      }

      return { id: job.id };
    }),

  /** Paginated history. Ordered newest-first — lines up with the UI table. */
  list: tenantProcedure
    .input(importListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const rows = await tx.importJob.findMany({
          where: { tenantId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
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

  /** Single job — includes errors + progress columns for the polling UI. */
  get: tenantProcedure
    .input(z.object({ id: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const job = await tx.importJob.findFirst({
          where: { id: input.id, tenantId },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        });
        if (!job) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Import job not found.',
          });
        }
        return job;
      });
    }),

  /**
   * Cancel a job. Transitions only from PENDING or PROCESSING — completed
   * and failed jobs are terminal (canceling after the fact has no effect
   * on already-imported contacts anyway).
   */
  cancel: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.importJob.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, status: true },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Import job not found.',
          });
        }
        if (
          existing.status !== ImportJobStatus.PENDING &&
          existing.status !== ImportJobStatus.PROCESSING
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot cancel a job in ${existing.status} state.`,
          });
        }
        await tx.importJob.update({
          where: { id: existing.id },
          data: {
            status: ImportJobStatus.CANCELED,
            completedAt: new Date(),
          },
        });
        return { ok: true as const };
      });
    }),
});
