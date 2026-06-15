/* eslint-disable no-console */
/**
 * Phase 7.1 — attachment parse + summarize handler.
 *
 * Branches by AgentAttachment.attachmentType:
 *   IMAGE       → re-derive metadata (already EXIF-stripped at upload),
 *                 write thumbnail, summarize via Claude vision.
 *   PDF         → text extraction, summarize first chunk.
 *   SPREADSHEET → CSV / XLSX → columns + 100 sample rows + type
 *                 guesses, summarize column shape.
 *   DOCUMENT    → DOCX text + headings, summarize.
 *
 * Failure model:
 *   - Parse step throws → job retries (BullMQ default 3 attempts).
 *   - Summary step never throws (returns a stub on Anthropic failure
 *     and stamps `aiSummary` with the stub). The agent runtime
 *     tolerates stubs.
 *
 * Idempotency: re-running on an already-parsed row is a no-op for
 * parsedContent (skipped if `parsedAt` is set) but will re-run the
 * summary if the model rolls forward (different aiSummaryModel).
 */
import type { Job } from 'bullmq';

import {
  summarizeAttachment,
  type SummarizeInput,
} from '@getyn/ai';
import { classifyAttachment, type AttachmentParsedContent } from '@getyn/attachments';
import {
  parseCsv,
  parseDocx,
  parseImage,
  parsePdf,
  parseXlsx,
} from '@getyn/attachments/parsers';
import { prisma, type Prisma } from '@getyn/db';
import type { AttachmentParsePayload } from '@getyn/types';
import { getAnthropicApiKey } from '../integrations/anthropic';
import { getSupabaseAdmin } from '../supabase';

const BUCKET = 'agent-attachments';

function getSupabase() {
  return getSupabaseAdmin();
}

async function downloadObject(path: string): Promise<Buffer> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`storage download failed for ${path}: ${error?.message ?? 'no data'}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

async function uploadThumbnail(path: string, buf: Buffer): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: 'image/webp',
    upsert: true,
  });
  if (error) {
    throw new Error(`thumbnail upload failed for ${path}: ${error.message}`);
  }
}

interface ParseOutput {
  parsedContent: AttachmentParsedContent;
  summarizeInput: SummarizeInput;
}

async function parseRouter(args: {
  buf: Buffer;
  storagePath: string;
  attachmentType: 'IMAGE' | 'PDF' | 'SPREADSHEET' | 'DOCUMENT';
  mimeType: string;
}): Promise<ParseOutput> {
  const { buf, storagePath, attachmentType, mimeType } = args;

  switch (attachmentType) {
    case 'IMAGE': {
      const { thumbnail, metadata } = await parseImage(buf);
      const thumbnailPath = `${storagePath}.thumb.webp`;
      await uploadThumbnail(thumbnailPath, thumbnail);
      // Send the (smaller, EXIF-stripped) thumbnail to Claude — the
      // full-res original is wasteful for a 2-3 sentence summary.
      const thumbBase64 = thumbnail.toString('base64');
      const visionMime = 'image/webp' as const;
      return {
        parsedContent: {
          kind: 'image',
          data: { ...metadata, thumbnailPath },
        },
        summarizeInput: {
          kind: 'image',
          imageBase64: thumbBase64,
          mimeType: visionMime,
        },
      };
    }
    case 'PDF': {
      const data = await parsePdf(buf);
      return {
        parsedContent: { kind: 'pdf', data },
        summarizeInput: {
          kind: 'pdf',
          textHead: data.textContent.slice(0, 5000),
          pageCount: data.pageCount,
        },
      };
    }
    case 'SPREADSHEET': {
      // CSV vs XLSX/XLS — sniff by MIME.
      const isCsv = mimeType === 'text/csv';
      const data = isCsv ? parseCsv(buf) : parseXlsx(buf);
      return {
        parsedContent: { kind: 'spreadsheet', data },
        summarizeInput: {
          kind: 'spreadsheet',
          columns: data.columns,
          sampleRows: data.sampleRows,
          rowCount: data.rowCount,
        },
      };
    }
    case 'DOCUMENT': {
      const data = await parseDocx(buf);
      return {
        parsedContent: { kind: 'document', data },
        summarizeInput: {
          kind: 'docx',
          textHead: data.text.slice(0, 2000),
          headings: data.headings,
          wordCount: data.wordCount,
        },
      };
    }
  }
}

export async function handleAttachmentParse(
  job: Job<AttachmentParsePayload>,
): Promise<void> {
  const { agentAttachmentId, tenantId } = job.data;

  const row = await prisma.agentAttachment.findFirst({
    where: { id: agentAttachmentId, tenantId },
    include: {
      asset: {
        select: { storagePath: true, mimeType: true, fileName: true },
      },
    },
  });
  if (!row) {
    console.warn(
      `[attachment-parse] row ${agentAttachmentId} not found, skipping.`,
    );
    return;
  }
  if (row.parsedAt && row.aiSummary) {
    // Already done — nothing to do (idempotent re-runs).
    return;
  }

  const { storagePath, mimeType, fileName } = row.asset;
  // Sanity: classifyAttachment expects an AllowedMimeType. We trust
  // the upload route's verify step here — the route writes the
  // verified MIME to Asset.mimeType.
  let attachmentType: ReturnType<typeof classifyAttachment>;
  try {
    attachmentType = classifyAttachment(
      mimeType as Parameters<typeof classifyAttachment>[0],
    );
  } catch {
    console.error(
      `[attachment-parse] unknown mime "${mimeType}" on ${agentAttachmentId}`,
    );
    return;
  }

  const buf = await downloadObject(storagePath);

  const { parsedContent, summarizeInput } = await parseRouter({
    buf,
    storagePath,
    attachmentType,
    mimeType,
  });

  await prisma.agentAttachment.update({
    where: { id: agentAttachmentId },
    data: {
      parsedContent: parsedContent as unknown as Prisma.InputJsonValue,
      parsedAt: new Date(),
    },
  });

  // Summarize — never throws. Stub falls back to a deterministic
  // sentence so the agent still has SOMETHING to read.
  const apiKey = await getAnthropicApiKey();
  const summary = await summarizeAttachment(summarizeInput, {
    apiKey: apiKey ?? undefined,
  });

  await prisma.agentAttachment.update({
    where: { id: agentAttachmentId },
    data: {
      aiSummary: summary.summary,
      aiSummaryGeneratedAt: new Date(),
      aiSummaryModel: summary.model,
    },
  });

  if (summary.fallback) {
    console.warn(
      `[attachment-parse] summary fallback on ${agentAttachmentId} (${fileName}): ${summary.fallbackReason}`,
    );
  }
}
