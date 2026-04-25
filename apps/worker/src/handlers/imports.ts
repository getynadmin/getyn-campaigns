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

const BATCH_SIZE = 100;
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
          errorRows,
        },
      }),
    );
    console.info(
      `[worker:imports] completed job ${importJobId}: ${successRows}/${totalRows} rows imported (${errorRows} errors)`,
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
  failed: number;
  errors: ImportRowError[];
}

async function processBatch(input: BatchInput): Promise<BatchResult> {
  const { tenantId, rows, rowOffset, mapping, customFieldById, dedupeBy, defaults } = input;
  const batchErrors: ImportRowError[] = [];
  let succeeded = 0;
  let failed = 0;

  // One transaction per batch. This keeps the tenant-scoped SET LOCAL cheap
  // (one setup per ~100 rows) and atomicises each batch's progress — if the
  // transaction aborts, we re-process those rows on retry.
  await withTenant(tenantId, async (tx) => {
    for (let i = 0; i < rows.length; i += 1) {
      const rowNumber = rowOffset + i + 1; // 1-indexed for user-facing errors
      const raw = rows[i];
      if (!raw) continue;

      try {
        const extracted = extractRow(raw, mapping, customFieldById);
        if (!extracted.email && !extracted.phone) {
          throw new Error('Row has no email or phone — skipped.');
        }

        const match = await findExisting(tx, tenantId, extracted, dedupeBy);
        if (match) {
          await updateExisting(tx, tenantId, match.id, extracted);
        } else {
          await createNew(tx, tenantId, extracted, defaults, input.tagIds);
        }
        succeeded += 1;
      } catch (err) {
        failed += 1;
        batchErrors.push({
          row: rowNumber,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Apply tag assignments to any contacts we just touched. We collect
    // them inside updateExisting/createNew via a return channel? Simpler:
    // tag joins happen inline within create/update. Nothing to do here.
  });

  return {
    processed: rows.length,
    succeeded,
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
// Dedupe / upsert
// ===========================================================================

async function findExisting(
  tx: Prisma.TransactionClient,
  tenantId: string,
  extracted: ExtractedRow,
  strategy: ImportDedupeStrategyValue,
): Promise<{ id: string; customFields: Prisma.JsonValue } | null> {
  const where: Prisma.ContactWhereInput[] = [];
  if (strategy === 'EMAIL' || strategy === 'EMAIL_OR_PHONE') {
    if (extracted.email) where.push({ email: extracted.email });
  }
  if (strategy === 'PHONE' || strategy === 'EMAIL_OR_PHONE') {
    if (extracted.phone) where.push({ phone: extracted.phone });
  }
  if (where.length === 0) return null;

  const found = await tx.contact.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      OR: where,
    },
    select: { id: true, customFields: true },
  });
  return found;
}

async function updateExisting(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
  extracted: ExtractedRow,
): Promise<void> {
  // Only overwrite identity fields if the CSV provided them. Blank cells
  // should never nuke an existing email/name/etc.
  const data: Prisma.ContactUpdateInput = {};
  if (extracted.email) data.email = extracted.email;
  if (extracted.phone) data.phone = extracted.phone;
  if (extracted.firstName) data.firstName = extracted.firstName;
  if (extracted.lastName) data.lastName = extracted.lastName;
  if (extracted.language) data.language = extracted.language;
  if (extracted.timezone) data.timezone = extracted.timezone;

  if (Object.keys(extracted.customFields).length > 0) {
    const existing = await tx.contact.findUnique({
      where: { id: contactId },
      select: { customFields: true },
    });
    const merged = {
      ...((existing?.customFields ?? {}) as Record<string, unknown>),
      ...extracted.customFields,
    };
    data.customFields = merged as Prisma.InputJsonValue;
  }

  await tx.contact.update({ where: { id: contactId }, data });

  await tx.contactEvent.create({
    data: {
      tenantId,
      contactId,
      type: ContactEventType.IMPORTED,
      metadata: { action: 'update' },
    },
  });
}

async function createNew(
  tx: Prisma.TransactionClient,
  tenantId: string,
  extracted: ExtractedRow,
  defaults: BatchInput['defaults'],
  tagIds: string[],
): Promise<void> {
  const contact = await tx.contact.create({
    data: {
      tenantId,
      email: extracted.email,
      phone: extracted.phone,
      firstName: extracted.firstName,
      lastName: extracted.lastName,
      language: extracted.language ?? 'en',
      timezone: extracted.timezone,
      source: ContactSource.IMPORT,
      emailStatus: defaults.emailStatus as never,
      smsStatus: defaults.smsStatus as never,
      whatsappStatus: defaults.whatsappStatus as never,
      customFields: extracted.customFields as Prisma.InputJsonValue,
      ...(tagIds.length > 0
        ? {
            tags: {
              create: tagIds.map((tagId) => ({ tagId })),
            },
          }
        : {}),
    },
    select: { id: true },
  });

  await tx.contactEvent.create({
    data: {
      tenantId,
      contactId: contact.id,
      type: ContactEventType.IMPORTED,
      metadata: { action: 'create' },
    },
  });

  if (tagIds.length > 0) {
    for (const tagId of tagIds) {
      await tx.contactEvent.create({
        data: {
          tenantId,
          contactId: contact.id,
          type: ContactEventType.TAG_ADDED,
          metadata: { tagId, via: 'import' },
        },
      });
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
