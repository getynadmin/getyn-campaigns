/* eslint-disable no-console */
/**
 * Phase 7.1 — Agent attachment upload.
 *
 * POST /api/agent/attachments/upload
 * multipart/form-data:
 *   - file: the binary
 *   - conversationId: AgentConversation.id (owned by caller's tenant)
 *
 * Flow:
 *   1. Auth: session + membership in the conversation's tenant.
 *      Read-only roles can attach (drafting is not gated; mutations
 *      to campaigns / contacts still are at the tRPC layer).
 *   2. Size + claimed MIME check.
 *   3. Magic-byte verification (rejects forbidden archives + spoofed
 *      MIME). For images, the buffer is replaced with the EXIF-stripped
 *      original from the parser pipeline before upload.
 *   4. Storage upload to `agent-attachments/{tenantId}/{conversationId}/{assetId}-{file}`.
 *   5. Create Asset + AgentAttachment + AgentConversationAttachment in
 *      a single transaction. Default `expiresAt = createdAt + 30 days`.
 *   6. Enqueue `attachment-parse` so heavy parsing happens off the
 *      request path. The UI gets `{ status: 'parsing' }` immediately
 *      and polls (or subscribes) for `parsedAt`.
 */
import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import {
  AttachmentVerifyError,
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  extensionFor,
  isAllowedMime,
  verifyAttachment,
} from '@getyn/attachments';
import { Role, prisma } from '@getyn/db';

import { publicEnv, serverEnv } from '@/lib/env';
import { enqueueAttachmentParse } from '@/server/queues';
import { getCurrentUser } from '@/server/auth/session';

const BUCKET = 'agent-attachments';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const runtime = 'nodejs';
// Up to 10MB body — Next App Router default is 1MB.
export const maxDuration = 60;

interface ErrorBody {
  error: string;
  code?: string;
}

function badRequest(message: string, status = 400, code?: string): NextResponse<ErrorBody> {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return badRequest('Sign in required.', 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest('Could not parse multipart body.');
  }

  const file = form.get('file');
  const conversationId = form.get('conversationId');
  if (!(file instanceof File)) return badRequest('Missing file.');
  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    return badRequest('Missing conversationId.');
  }
  if (file.size === 0) return badRequest('File is empty.');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return badRequest(
      `File exceeds the 10MB limit (${Math.round(file.size / 1024)} KB).`,
      413,
    );
  }
  if (!isAllowedMime(file.type)) {
    return badRequest(`Unsupported file type: ${file.type || '(unset)'}`, 415);
  }

  // Resolve conversation + tenant membership in one read.
  const convo = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, tenantId: true, status: true },
  });
  if (!convo) return badRequest('Conversation not found.', 404);
  if (convo.status !== 'ACTIVE') {
    return badRequest('Conversation is closed — attachments can only be added to active conversations.', 409);
  }
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: convo.tenantId } },
    select: { role: true },
  });
  if (!membership) return badRequest('No access to this workspace.', 403);
  if (membership.role === Role.VIEWER) {
    return badRequest('Viewers cannot upload attachments.', 403);
  }

  // Verify against magic bytes. Throws AttachmentVerifyError on bad
  // input — caught and translated to a 415 below.
  const rawBuf = Buffer.from(await file.arrayBuffer());
  let verifiedMime: ReturnType<typeof classifyAttachment> extends never
    ? never
    : Awaited<ReturnType<typeof verifyAttachment>>['verifiedMime'];
  try {
    const v = await verifyAttachment(rawBuf, file.type);
    verifiedMime = v.verifiedMime;
  } catch (err) {
    if (err instanceof AttachmentVerifyError) {
      return badRequest(err.message, 415, err.code);
    }
    console.error('[agent-attachments] verify failed:', err);
    return badRequest('Could not verify file.', 500);
  }

  const attachmentType = classifyAttachment(verifiedMime);
  const assetId = randomUUID();
  const ext = extensionFor(verifiedMime);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  const objectPath = `${convo.tenantId}/${convo.id}/${assetId}-${safeName || `file.${ext}`}`;

  // For images, strip EXIF here so what lands in Storage is already
  // clean. The full parser pipeline (thumbnail, dimensions) runs in
  // the worker; we only do the EXIF-strip eagerly because we don't
  // want the user's GPS coordinates in Storage even briefly.
  let uploadBuf: Buffer = rawBuf;
  if (attachmentType === 'IMAGE') {
    try {
      const { parseImage } = await import('@getyn/attachments/parsers');
      const { cleanedOriginal } = await parseImage(rawBuf);
      uploadBuf = cleanedOriginal as Buffer;
    } catch (err) {
      console.error('[agent-attachments] EXIF strip failed, uploading raw:', err);
      // Non-fatal — fall through with the raw buffer. The worker will
      // re-derive metadata when it parses.
    }
  }

  const supabase = createClient(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, uploadBuf, {
      contentType: verifiedMime,
      upsert: false,
    });
  if (upErr) {
    console.error('[agent-attachments] upload failed:', upErr.message);
    return badRequest(upErr.message, 500);
  }

  // DB writes — Asset + AgentAttachment + join — in one transaction so
  // a Storage upload that succeeded but a DB write that failed leaves
  // a verifiable orphan: the next cleanup cron will catch it.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);

  try {
    const { agentAttachment } = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          tenantId: convo.tenantId,
          fileName: safeName || file.name,
          mimeType: verifiedMime,
          sizeBytes: uploadBuf.byteLength,
          storagePath: objectPath,
          uploadedByUserId: user.id,
        },
      });
      const agentAttachment = await tx.agentAttachment.create({
        data: {
          tenantId: convo.tenantId,
          assetId: asset.id,
          attachmentType,
          expiresAt,
        },
      });
      await tx.agentConversationAttachment.create({
        data: {
          tenantId: convo.tenantId,
          conversationId: convo.id,
          agentAttachmentId: agentAttachment.id,
        },
      });
      return { agentAttachment };
    });

    await enqueueAttachmentParse({
      agentAttachmentId: agentAttachment.id,
      tenantId: convo.tenantId,
    });

    return NextResponse.json({
      attachmentId: agentAttachment.id,
      assetId: agentAttachment.assetId,
      attachmentType,
      mimeType: verifiedMime,
      sizeBytes: uploadBuf.byteLength,
      status: 'parsing' as const,
    });
  } catch (err) {
    console.error('[agent-attachments] db write failed, removing storage object:', err);
    await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => null);
    return badRequest('Failed to persist attachment.', 500);
  }
}
