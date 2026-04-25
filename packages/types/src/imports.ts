/**
 * Zod schemas for Phase 2 CSV imports.
 *
 * The wizard runs in three stages on the client:
 *   1. Upload — pick a file, preview the first ~100 rows (papaparse in-browser).
 *   2. Map — decide what each CSV column becomes: a contact field, a custom
 *      field, or skipped.
 *   3. Run — push the file to Supabase Storage via a signed URL, create an
 *      ImportJob row (PENDING), enqueue a BullMQ job, redirect to progress.
 *
 * Everything the wizard sends the server is validated by these schemas.
 * The worker re-parses the ImportJob row it reads from the database, so
 * these shapes are also the contract between producer and consumer.
 */
import { z } from 'zod';

import { cuidSchema } from './common';
import { subscriptionStatusSchema } from './contacts';

// ---------------------------------------------------------------------------
// Enums (mirror Prisma's `ImportDedupeStrategy` / `ImportJobStatus`)
// ---------------------------------------------------------------------------

export const importDedupeStrategySchema = z.enum([
  'EMAIL',
  'PHONE',
  'EMAIL_OR_PHONE',
]);
export type ImportDedupeStrategyValue = z.infer<typeof importDedupeStrategySchema>;

export const importJobStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
]);
export type ImportJobStatusValue = z.infer<typeof importJobStatusSchema>;

// ---------------------------------------------------------------------------
// Mapping — per CSV column
// ---------------------------------------------------------------------------

/**
 * The set of contact scalar fields a CSV column can map to. We deliberately
 * leave statuses out — those come from the "default status" picker on the
 * wizard so every imported row gets the same policy (mixing per-row statuses
 * from a sheet is a foot-gun).
 */
export const importContactFieldSchema = z.enum([
  'email',
  'phone',
  'firstName',
  'lastName',
  'language',
  'timezone',
]);
export type ImportContactField = z.infer<typeof importContactFieldSchema>;

/**
 * Discriminated union so downstream code can `switch (entry.kind)` cleanly.
 * A single `kind: 'skip'` variant is kept (rather than just leaving the
 * column out of the mapping bag) so the UI can show "Skip" as an explicit
 * choice and we can round-trip the full mapping through the DB for audit.
 */
export const importColumnMappingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field'),
    field: importContactFieldSchema,
  }),
  z.object({
    kind: z.literal('custom_field'),
    customFieldId: cuidSchema,
  }),
  z.object({
    kind: z.literal('skip'),
  }),
]);
export type ImportColumnMapping = z.infer<typeof importColumnMappingSchema>;

/**
 * Full mapping: keyed by the raw CSV header string the user uploaded. Keys
 * are preserved verbatim (case + whitespace) so the worker can look them up
 * against parsed row records exactly.
 */
export const importMappingSchema = z
  .record(z.string().min(1).max(200), importColumnMappingSchema)
  .superRefine((mapping, ctx) => {
    // Enforce exactly-one column per contact field. Users can still have any
    // number of custom-field or skip columns.
    const usedFields = new Map<ImportContactField, string[]>();
    for (const [column, entry] of Object.entries(mapping)) {
      if (entry.kind === 'field') {
        const existing = usedFields.get(entry.field) ?? [];
        existing.push(column);
        usedFields.set(entry.field, existing);
      }
    }
    for (const [field, columns] of usedFields.entries()) {
      if (columns.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Multiple columns mapped to ${field}: ${columns.join(', ')}. Pick one.`,
          path: [columns[0] ?? field],
        });
      }
    }
    // Require at least one identity column — email or phone — otherwise every
    // row would fail the "email or phone required" dedupe check.
    const hasIdentity = Array.from(usedFields.keys()).some(
      (f) => f === 'email' || f === 'phone',
    );
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Map at least one column to email or phone.',
        path: [],
      });
    }
  });
export type ImportMapping = z.infer<typeof importMappingSchema>;

// ---------------------------------------------------------------------------
// Upload request
// ---------------------------------------------------------------------------

/**
 * Ask the server for a signed Supabase Storage URL to PUT the file to.
 * Keep this small — no mapping is decided yet at upload time.
 */
export const importRequestUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/\.csv$/i, 'File must be a .csv'),
  /** Client-reported byte size; used for a soft cap so we don't mint a URL
   * for a 1GB file that Storage will reject later. */
  size: z
    .number()
    .int()
    .nonnegative()
    .max(50 * 1024 * 1024, 'Max 50MB per import')
    .optional(),
});
export type ImportRequestUploadInput = z.infer<typeof importRequestUploadSchema>;

// ---------------------------------------------------------------------------
// Start import
// ---------------------------------------------------------------------------

/**
 * Once the file is in Supabase Storage and the user has finished the mapping
 * wizard, the web app calls `start` with the mapping + defaults + tagIds.
 * The router creates the ImportJob row (PENDING) and enqueues one BullMQ
 * job. `storagePath` must be the path the server issued from
 * `requestUpload` — the server re-checks it starts with the tenant id so a
 * client can't point the worker at another tenant's file.
 */
export const importStartSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  storagePath: z.string().trim().min(1).max(500),
  mapping: importMappingSchema,
  tagIds: z.array(cuidSchema).max(50).optional(),
  defaultEmailStatus: subscriptionStatusSchema.default('SUBSCRIBED'),
  defaultSmsStatus: subscriptionStatusSchema.default('SUBSCRIBED'),
  defaultWhatsappStatus: subscriptionStatusSchema.default('SUBSCRIBED'),
  dedupeBy: importDedupeStrategySchema.default('EMAIL_OR_PHONE'),
});
export type ImportStartInput = z.infer<typeof importStartSchema>;

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

export const importListInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: cuidSchema.optional(),
});
export type ImportListInput = z.infer<typeof importListInputSchema>;

// ---------------------------------------------------------------------------
// Errors bag (written to ImportJob.errors as JSON)
// ---------------------------------------------------------------------------

/**
 * Per-row error captured during processing. Capped at 100 entries on the
 * row + a trailing `{ truncated: true }` sentinel when we stop collecting.
 */
export const importRowErrorSchema = z.object({
  row: z.number().int().nonnegative(),
  message: z.string().max(500),
});
export type ImportRowError = z.infer<typeof importRowErrorSchema>;

export const importErrorsSchema = z
  .array(z.union([importRowErrorSchema, z.object({ truncated: z.boolean() })]))
  .max(101);
export type ImportErrors = z.infer<typeof importErrorsSchema>;

/** Hard cap on retained row errors per job. */
export const IMPORT_ERROR_CAP = 100;
