import { nanoid } from 'nanoid';
import Papa from 'papaparse';
import type { Job } from 'bullmq';

import {
  ContactEventType,
  ContactSource,
  ImportJobStatus,
  prisma,
  withTenant,
} from '@getyn/db';
import type { Prisma } from '@getyn/db';
import {
  IMPORT_ERROR_CAP,
  importJobPayloadSchema,
  importMappingSchema,
  type ImportColumnMapping,
  type ImportContactField,
  type ImportDedupeStrategyValue,
  type ImportJobPayload,
  type ImportMapping,
  type ImportRowError,
} from '@getyn/types';

import { getSupabaseAdmin } from '../supabase';

/** Rows per batch. With the bulk-operations refactor (one SELECT for
 *  dedupe + a handful of createMany calls per batch), per-batch
 *  query count is now constant ~5 regardless of row count — so we
 *  can keep batches large for fewer transaction round-trips.
 *  500 fits comfortably inside the 60s window even at Supabase's
 *  worst pgbouncer latency. */
const BATCH_SIZE = 500;
/** Per-batch transaction window. Defaults to Prisma's 5s, which is
 *  too tight for the bulk-import workload. */
const BATCH_TX_TIMEOUT_MS = 60_000;
const BATCH_TX_MAX_WAIT_MS = 10_000;
const IMPORT_BUCKET = 'imports';
/** A loose email regex — matches the intent of contactEmailSchema without
 *  pulling Zod into the hot loop. Good enough to reject obviously bad rows. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Same trade-off for phones: at least one digit, optional +, no letters. */
const PHONE_RE = /^\+?[0-9()\s.-]{4,20}$/;

/**
 * Handler for the `imports` queue. Pipeline:
 *   1. Load the ImportJob row (under tenant RLS) → flip to PROCESSING.
 *   2. Download the CSV from Supabase Storage using service-role creds.
 *   3. Parse in-memory (papaparse synchronous) — gives us header names +
 *      row count up front, at the cost of holding the whole file in RAM.
 *      With the 50MB upload cap that's fine for Phase 2.
 *   4. Load the tenant's CustomField registry once; we only need id+key+type.
 *   5. Walk rows in batches of 100:
 *        - Before each batch, re-read status. If the UI called `cancel`,
 *          stop gracefully (status stays CANCELED, progress is retained).
 *        - Per row: apply mapping → dedupe → upsert → tag join → emit
 *          IMPORTED event.
 *        - After batch: persist counters + rolling error list so the UI
 *          polling `imports.get` sees steady progress.
 *   6. On fatal error: FAILED + completedAt. On clean exit: COMPLETED.
 *
 * BullMQ retries (attempts: 3, exponential backoff) only kick in if the
 * handler *throws*. Row-level errors are captured and swallowed — they
 * shouldn't cause the whole job to re-run.
 */
export async function handleImportJob(job: Job<unknown>): Promise<void> {
  const payload: ImportJobPayload = importJobPayloadSchema.parse(job.data);
  const { importJobId, tenantId } = payload;

  console.info(
    `[worker:imports] start job=${job.id} importJob=${importJobId} tenant=${tenantId}`,
  );

  // ---------- Load the job row -------------------------------------------
  const row = await withTenant(tenantId, (tx) =>
    tx.importJob.findFirst({ where: { id: importJobId, tenantId } }),
  );
  if (!row) {
    // Log + swallow (no retry): the row must have been deleted between
    // enqueue and pickup. Nothing useful to do.
    console.warn(`[worker:imports] job row not found for ${importJobId} — skipping`);
    return;
  }
  if (
    row.status === ImportJobStatus.COMPLETED ||
    row.status === ImportJobStatus.CANCELED ||
    row.status === ImportJobStatus.FAILED
  ) {
    console.info(
      `[worker:imports] job ${importJobId} already in terminal state ${row.status} — skipping`,
    );
    return;
  }

  // Idempotency: if a prior attempt crashed partway, we'll re-process rows
  // that have already been imported. Dedupe on (email/phone) inside each
  // batch catches most of those. Stronger idempotency (tracked row offsets)
  // is deferred to a future milestone.
  const mappingResult = importMappingSchema.safeParse(row.mapping);
  if (!mappingResult.success) {
    await markFailed(importJobId, tenantId, 'Mapping is invalid — cannot process.');
    return;
  }
  const mapping = mappingResult.data;

  // ---------- Flip to PROCESSING -----------------------------------------
  await withTenant(tenantId, (tx) =>
    tx.importJob.update({
      where: { id: importJobId },
      data: { status: ImportJobStatus.PROCESSING, startedAt: new Date() },
    }),
  );

  try {
    // -------- Download CSV ----------------------------------------------
    const supabase = getSupabaseAdmin();
    const download = await supabase.storage
      .from(IMPORT_BUCKET)
      .download(row.storagePath);
    if (download.error || !download.data) {
      throw new Error(
        `Could not download CSV from storage: ${download.error?.message ?? 'no data'}`,
      );
    }
    const csvText = await download.data.text();

    // -------- Parse -----------------------------------------------------
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: 'greedy',
      // Keep values as strings — we coerce per field type below.
      dynamicTyping: false,
    });
    // PapaParse's `errors` mostly flags malformed rows. We log them but
    // don't fail the job: a single bad line shouldn't abort the import.
    if (parsed.errors.length > 0) {
      console.warn(
        `[worker:imports] ${parsed.errors.length} parse warning(s) for job ${importJobId}`,
      );
    }
    const rows = parsed.data;
    const totalRows = rows.length;

    await withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: importJobId },
        data: { totalRows },
      }),
    );

    // -------- Cache CustomField registry --------------------------------
    const customFields = await withTenant(tenantId, (tx) =>
      tx.customField.findMany({
        where: { tenantId },
        select: { id: true, key: true, type: true },
      }),
    );
    const customFieldById = new Map(customFields.map((f) => [f.id, f] as const));

    // -------- Process in batches ----------------------------------------
    let processedRows = 0;
    let successRows = 0;
    let updatedRows = 0;
    let errorRows = 0;
    const errors: ImportRowError[] = [];
    let truncatedFlagAdded = false;

    for (let start = 0; start < totalRows; start += BATCH_SIZE) {
      // Check cancellation flag before every batch. Reads go outside
      // withTenant (system read, cheap) and flip in just-in-time.
      const current = await prisma.importJob.findUnique({
        where: { id: importJobId },
        select: { status: true },
      });
      if (current?.status === ImportJobStatus.CANCELED) {
        console.info(
          `[worker:imports] job ${importJobId} canceled at row ${processedRows}/${totalRows}`,
        );
        await persistProgress(importJobId, tenantId, {
          processedRows,
          successRows,
          updatedRows,
          errorRows,
          errors,
          truncatedFlagAdded,
        });
        return;
      }

      const batch = rows.slice(start, start + BATCH_SIZE);
      const batchResult = await processBatch({
        tenantId,
        rows: batch,
        rowOffset: start,
        mapping,
        customFieldById,
        tagIds: row.tagIds,
        dedupeBy: row.dedupeBy as ImportDedupeStrategyValue,
        defaults: {
          emailStatus: row.defaultEmailStatus,
          smsStatus: row.defaultSmsStatus,
          whatsappStatus: row.defaultWhatsappStatus,
        },
      });

      processedRows += batchResult.processed;
      successRows += batchResult.succeeded;
      updatedRows += batchResult.updated;
      errorRows += batchResult.failed;
      for (const err of batchResult.errors) {
        if (errors.length < IMPORT_ERROR_CAP) {
          errors.push(err);
        } else if (!truncatedFlagAdded) {
          truncatedFlagAdded = true;
        }
      }

      await persistProgress(importJobId, tenantId, {
        processedRows,
        successRows,
        updatedRows,
        errorRows,
        errors,
        truncatedFlagAdded,
      });
    }

    // -------- Finalise --------------------------------------------------
    await withTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: importJobId },
        data: {
          status: ImportJobStatus.COMPLETED,
          completedAt: new Date(),
          processedRows,
          successRows,
          updatedRows,
          errorRows,
        },
      }),
    );
    console.info(
      `[worker:imports] completed job ${importJobId}: ${successRows}/${totalRows} rows imported (${updatedRows} updates, ${errorRows} errors)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker:imports] job ${importJobId} failed: ${message}`);
    await markFailed(importJobId, tenantId, message);
    // Rethrow so BullMQ retries on transient failures. The status is
    // already FAILED; the next attempt re-reads and re-runs from the top.
    throw err;
  }
}

// ===========================================================================
// Batch processing
// ===========================================================================

interface BatchInput {
  tenantId: string;
  rows: Record<string, string>[];
  rowOffset: number;
  mapping: ImportMapping;
  customFieldById: Map<
    string,
    { id: string; key: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT' }
  >;
  tagIds: string[];
  dedupeBy: ImportDedupeStrategyValue;
  defaults: {
    emailStatus: string;
    smsStatus: string;
    whatsappStatus: string;
  };
}

interface BatchResult {
  processed: number;
  succeeded: number;
  /** Of `succeeded`, how many were updates to pre-existing contacts. */
  updated: number;
  failed: number;
  errors: ImportRowError[];
}

/**
 * Bulk-batch processor — replaces the per-row loop with a small
 * fixed number of queries regardless of batch size.
 *
 * Per batch, against Supabase:
 *   1 SELECT (dedupe lookup, OR'd on email + phone)
 *   1 createMany (Contact rows; IDs pre-generated client-side so we
 *     can reference them in the subsequent inserts without a
 *     round-trip back to fetch them)
 *   1 createMany (ContactEvent IMPORTED rows for the creates)
 *   1 createMany (ContactTag joins, if tags configured)
 *   1 createMany (ContactEvent TAG_ADDED rows, if tags configured)
 *   N UPDATEs (one per row where dedupe matched an existing
 *     contact). On a fresh import this is usually 0 or a handful;
 *     on a re-import it's the dominant cost.
 *
 * Versus the prior per-row design that fired 3-5 queries per row,
 * this is ~60x fewer round-trips for a typical fresh import.
 *
 * Trade-off: row-level extraction errors are still attributed to
 * specific row numbers, but createMany-level failures (e.g. a unique
 * constraint violation between rows in the same batch — which the
 * schema doesn't have today but could in the future) collapse to
 * a single failure attribution. The schema enforces uniqueness at
 * the tenant scope, not globally; intra-batch dupes within a CSV
 * upload would be a user-error case the import wizard should
 * de-dupe up front.
 */
async function processBatch(input: BatchInput): Promise<BatchResult> {
  const {
    tenantId,
    rows,
    rowOffset,
    mapping,
    customFieldById,
    dedupeBy,
    defaults,
    tagIds,
  } = input;
  const batchErrors: ImportRowError[] = [];

  // ---- Phase 1: extract everything client-side (no DB). -------------------
  interface ExtractedEntry {
    rowNumber: number;
    ext: ExtractedRow;
  }
  const valid: ExtractedEntry[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const rowNumber = rowOffset + i + 1;
    const raw = rows[i];
    if (!raw) continue;
    try {
      const ext = extractRow(raw, mapping, customFieldById);
      if (!ext.email && !ext.phone) {
        throw new Error('Row has no email or phone — skipped.');
      }
      valid.push({ rowNumber, ext });
    } catch (err) {
      batchErrors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
  let succeeded = 0;
  let updated = 0;
  let failed = batchErrors.length;

  if (valid.length === 0) {
    return {
      processed: rows.length,
      succeeded,
      updated,
      failed,
      errors: batchErrors,
    };
  }

  // ---- Phase 2: DB work in one transaction. ------------------------------
  await withTenant(
    tenantId,
    async (tx) => {
      // 2a. One dedupe lookup for the whole batch.
      const emails = valid
        .map((v) => v.ext.email)
        .filter((e): e is string => !!e);
      const phones = valid
        .map((v) => v.ext.phone)
        .filter((p): p is string => !!p);
      const dedupeOr: Prisma.ContactWhereInput[] = [];
      if (dedupeBy === 'EMAIL' || dedupeBy === 'EMAIL_OR_PHONE') {
        if (emails.length) dedupeOr.push({ email: { in: emails } });
      }
      if (dedupeBy === 'PHONE' || dedupeBy === 'EMAIL_OR_PHONE') {
        if (phones.length) dedupeOr.push({ phone: { in: phones } });
      }

      const existing =
        dedupeOr.length > 0
          ? await tx.contact.findMany({
              where: { tenantId, deletedAt: null, OR: dedupeOr },
              select: {
                id: true,
                email: true,
                phone: true,
                customFields: true,
              },
            })
          : [];

      const byEmail = new Map<string, (typeof existing)[number]>();
      const byPhone = new Map<string, (typeof existing)[number]>();
      for (const e of existing) {
        if (e.email) byEmail.set(e.email, e);
        if (e.phone) byPhone.set(e.phone, e);
      }

      // 2b. Partition into creates vs updates.
      const toCreate: Array<{
        rowNumber: number;
        ext: ExtractedRow;
        id: string;
      }> = [];
      const toUpdate: Array<{
        rowNumber: number;
        ext: ExtractedRow;
        existing: (typeof existing)[number];
      }> = [];

      for (const v of valid) {
        let match: (typeof existing)[number] | undefined;
        if (dedupeBy === 'EMAIL' || dedupeBy === 'EMAIL_OR_PHONE') {
          if (v.ext.email) match = byEmail.get(v.ext.email);
        }
        if (!match && (dedupeBy === 'PHONE' || dedupeBy === 'EMAIL_OR_PHONE')) {
          if (v.ext.phone) match = byPhone.get(v.ext.phone);
        }
        if (match) {
          toUpdate.push({ rowNumber: v.rowNumber, ext: v.ext, existing: match });
        } else {
          toCreate.push({
            rowNumber: v.rowNumber,
            ext: v.ext,
            // Pre-generate the id so downstream createMany calls
            // (ContactEvent, ContactTag) can reference it without a
            // round-trip back to fetch newly-inserted ids. nanoid is
            // opaque to Prisma — the schema's @default(cuid()) only
            // fires when we don't provide an id.
            id: nanoid(),
          });
        }
      }

      // 2c. Bulk create new contacts.
      if (toCreate.length > 0) {
        try {
          await tx.contact.createMany({
            data: toCreate.map((c) => ({
              id: c.id,
              tenantId,
              email: c.ext.email,
              phone: c.ext.phone,
              firstName: c.ext.firstName,
              lastName: c.ext.lastName,
              language: c.ext.language ?? 'en',
              timezone: c.ext.timezone,
              source: ContactSource.IMPORT,
              emailStatus: defaults.emailStatus as never,
              smsStatus: defaults.smsStatus as never,
              whatsappStatus: defaults.whatsappStatus as never,
              customFields: c.ext.customFields as Prisma.InputJsonValue,
            })),
            skipDuplicates: true,
          });
          succeeded += toCreate.length;
        } catch (err) {
          // Bulk insert failed — attribute the error to every row in
          // the batch's create set, then bail. The job's overall
          // status will reflect this on the next progress write.
          for (const c of toCreate) {
            batchErrors.push({
              row: c.rowNumber,
              message: err instanceof Error ? err.message : 'createMany failed',
            });
            failed += 1;
          }
          return;
        }

        // 2d. Bulk insert IMPORTED events for the creates.
        await tx.contactEvent.createMany({
          data: toCreate.map((c) => ({
            tenantId,
            contactId: c.id,
            type: ContactEventType.IMPORTED,
            metadata: { action: 'create' } as Prisma.InputJsonValue,
          })),
        });

        // 2e. Bulk insert tag joins + TAG_ADDED events for the creates.
        if (tagIds.length > 0) {
          const tagJoins = toCreate.flatMap((c) =>
            tagIds.map((tagId) => ({ contactId: c.id, tagId })),
          );
          await tx.contactTag.createMany({
            data: tagJoins,
            skipDuplicates: true,
          });
          const tagEvents = toCreate.flatMap((c) =>
            tagIds.map((tagId) => ({
              tenantId,
              contactId: c.id,
              type: ContactEventType.TAG_ADDED,
              metadata: { tagId, via: 'import' } as Prisma.InputJsonValue,
            })),
          );
          await tx.contactEvent.createMany({ data: tagEvents });
        }
      }

      // 2f. Per-row updates for the existing matches. These run one
      //     UPDATE per row because the field set differs per row;
      //     batching would require raw SQL and isn't worth the
      //     complexity for what's usually the minority path.
      for (const u of toUpdate) {
        try {
          const data: Prisma.ContactUpdateInput = {};
          if (u.ext.email) data.email = u.ext.email;
          if (u.ext.phone) data.phone = u.ext.phone;
          if (u.ext.firstName) data.firstName = u.ext.firstName;
          if (u.ext.lastName) data.lastName = u.ext.lastName;
          if (u.ext.language) data.language = u.ext.language;
          if (u.ext.timezone) data.timezone = u.ext.timezone;
          if (Object.keys(u.ext.customFields).length > 0) {
            const merged = {
              ...((u.existing.customFields ?? {}) as Record<string, unknown>),
              ...u.ext.customFields,
            };
            data.customFields = merged as Prisma.InputJsonValue;
          }
          await tx.contact.update({ where: { id: u.existing.id }, data });
          await tx.contactEvent.create({
            data: {
              tenantId,
              contactId: u.existing.id,
              type: ContactEventType.IMPORTED,
              metadata: { action: 'update' } as Prisma.InputJsonValue,
            },
          });
          succeeded += 1;
          updated += 1;
        } catch (err) {
          failed += 1;
          batchErrors.push({
            row: u.rowNumber,
            message: err instanceof Error ? err.message : 'update failed',
          });
        }
      }
    },
    { timeout: BATCH_TX_TIMEOUT_MS, maxWait: BATCH_TX_MAX_WAIT_MS },
  );

  return {
    processed: rows.length,
    succeeded,
    updated,
    failed,
    errors: batchErrors,
  };
}

// ===========================================================================
// Row extraction + coercion
// ===========================================================================

interface ExtractedRow {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  language: string | null;
  timezone: string | null;
  customFields: Record<string, string | number | boolean | null>;
}

function extractRow(
  raw: Record<string, string>,
  mapping: ImportMapping,
  customFieldById: BatchInput['customFieldById'],
): ExtractedRow {
  const out: ExtractedRow = {
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    language: null,
    timezone: null,
    customFields: {},
  };

  for (const [column, entry] of Object.entries(mapping) as Array<
    [string, ImportColumnMapping]
  >) {
    const value = raw[column];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === '') continue;

    if (entry.kind === 'skip') continue;

    if (entry.kind === 'field') {
      assignContactField(out, entry.field, trimmed);
    } else if (entry.kind === 'custom_field') {
      const def = customFieldById.get(entry.customFieldId);
      if (!def) continue;
      const coerced = coerceCustomFieldValue(trimmed, def.type);
      if (coerced.ok) {
        out.customFields[def.key] = coerced.value;
      } else {
        throw new Error(`Column "${column}" could not be parsed as ${def.type}.`);
      }
    }
  }

  return out;
}

function assignContactField(
  out: ExtractedRow,
  field: ImportContactField,
  value: string,
): void {
  switch (field) {
    case 'email': {
      const normalised = value.toLowerCase();
      if (!EMAIL_RE.test(normalised)) throw new Error(`Invalid email: "${value}"`);
      out.email = normalised;
      return;
    }
    case 'phone': {
      if (!PHONE_RE.test(value)) throw new Error(`Invalid phone: "${value}"`);
      out.phone = value;
      return;
    }
    case 'firstName':
      out.firstName = value.slice(0, 80);
      return;
    case 'lastName':
      out.lastName = value.slice(0, 80);
      return;
    case 'language': {
      // Zod regex equivalent: "en" or "en-US"
      if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)) {
        throw new Error(`Invalid language tag: "${value}"`);
      }
      out.language = value;
      return;
    }
    case 'timezone':
      out.timezone = value.slice(0, 64);
      return;
  }
}

/**
 * Coerce a string from a CSV cell into the value shape Prisma expects for
 * a custom-field bag. Each branch is narrow on purpose — we want garbage
 * cells to error loudly rather than silently become 0 / false / "".
 */
function coerceCustomFieldValue(
  value: string,
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT',
):
  | { ok: true; value: string | number | boolean | null }
  | { ok: false } {
  switch (type) {
    case 'TEXT':
    case 'SELECT':
      return { ok: true, value };
    case 'NUMBER': {
      const n = Number(value.replace(/,/g, ''));
      if (!Number.isFinite(n)) return { ok: false };
      return { ok: true, value: n };
    }
    case 'BOOLEAN': {
      const lc = value.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(lc)) return { ok: true, value: true };
      if (['false', 'no', 'n', '0'].includes(lc)) return { ok: true, value: false };
      return { ok: false };
    }
    case 'DATE': {
      // Store ISO strings; we don't have a datetime type on the bag.
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return { ok: false };
      return { ok: true, value: d.toISOString() };
    }
  }
}

// ===========================================================================
// Progress helpers
// ===========================================================================

async function persistProgress(
  importJobId: string,
  tenantId: string,
  progress: {
    processedRows: number;
    successRows: number;
    updatedRows: number;
    errorRows: number;
    errors: ImportRowError[];
    truncatedFlagAdded: boolean;
  },
): Promise<void> {
  const errorsPayload: Prisma.InputJsonValue = [
    ...progress.errors,
    ...(progress.truncatedFlagAdded ? [{ truncated: true }] : []),
  ];
  await withTenant(tenantId, (tx) =>
    tx.importJob.update({
      where: { id: importJobId },
      data: {
        processedRows: progress.processedRows,
        successRows: progress.successRows,
        updatedRows: progress.updatedRows,
        errorRows: progress.errorRows,
        errors: errorsPayload,
      },
    }),
  );
}

async function markFailed(
  importJobId: string,
  tenantId: string,
  message: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.importJob.update({
      where: { id: importJobId },
      data: {
        status: ImportJobStatus.FAILED,
        completedAt: new Date(),
        errors: [{ row: 0, message: message.slice(0, 500) }] as Prisma.InputJsonValue,
      },
    }),
  );
}
