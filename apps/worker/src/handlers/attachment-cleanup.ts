/* eslint-disable no-console */
/**
 * Phase 7.1 — daily attachment cleanup.
 *
 * Deletes AgentAttachment rows + the underlying Storage object + the
 * Asset row, in that order. Only operates on rows where:
 *   - expiresAt < now (not pinned to a finalized plan)
 *   - the conversation referencing them is NOT active OR the last
 *     message is > 7 days old
 *
 * Ordering matters: Storage delete first means the worst-case failure
 * is "DB row points to a missing Storage object" which the upload
 * route would never recreate. The reverse ordering risks orphaned
 * Storage objects we can't enumerate.
 */
import { prisma } from '@getyn/db';

import { getSupabaseAdmin } from '../supabase';

const BUCKET = 'agent-attachments';
const ACTIVE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Candidate {
  id: string;
  assetId: string;
  storagePath: string;
  thumbnailPath: string | null;
}

async function findCandidates(limit = 200): Promise<Candidate[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - ACTIVE_AGE_MS);

  // Pull expired attachments whose conversations are stale. The join
  // is OK as raw SQL because Prisma can't express "NOT EXISTS" against
  // the M:N AgentConversationAttachment with the date filter cleanly.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      assetId: string;
      storagePath: string;
      attachmentType: string;
    }>
  >`
    SELECT
      aa.id          AS "id",
      aa."assetId"   AS "assetId",
      a."storagePath" AS "storagePath",
      aa."attachmentType" AS "attachmentType"
    FROM "AgentAttachment" aa
    JOIN "Asset" a ON a.id = aa."assetId"
    WHERE aa."expiresAt" IS NOT NULL
      AND aa."expiresAt" < ${now}
      AND NOT EXISTS (
        SELECT 1
        FROM "AgentConversationAttachment" link
        JOIN "AgentConversation" c ON c.id = link."conversationId"
        WHERE link."agentAttachmentId" = aa.id
          AND c.status = 'ACTIVE'
          AND c."lastMessageAt" > ${cutoff}
      )
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    storagePath: r.storagePath,
    thumbnailPath:
      r.attachmentType === 'IMAGE' ? `${r.storagePath}.thumb.webp` : null,
  }));
}

export async function handleAttachmentCleanup(): Promise<void> {
  const candidates = await findCandidates();
  if (candidates.length === 0) {
    console.info('[attachment-cleanup] no candidates.');
    return;
  }
  console.info(`[attachment-cleanup] processing ${candidates.length} expired attachments.`);

  const supabase = getSupabaseAdmin();
  let deleted = 0;
  let storageErrors = 0;

  for (const c of candidates) {
    const paths = [c.storagePath];
    if (c.thumbnailPath) paths.push(c.thumbnailPath);
    // Best-effort storage delete first. A 404 here is fine — the row
    // might have been uploaded without a thumbnail, or already cleaned
    // up by a prior run that crashed before the DB delete.
    const { error: storageErr } = await supabase.storage
      .from(BUCKET)
      .remove(paths);
    if (storageErr) {
      storageErrors += 1;
      console.warn(
        `[attachment-cleanup] storage remove failed for ${c.id} (${c.storagePath}): ${storageErr.message}`,
      );
      // Don't skip — better to land with a stale DB row than to leave
      // both halves in zombie state. The next run can re-attempt.
    }

    try {
      // AgentConversationAttachment cascades. AgentAttachment FK to
      // Asset is RESTRICT, so we delete AgentAttachment first, then
      // Asset (which then cascades to nothing — Asset only has back
      // refs through this and the email/wa libraries which are
      // unrelated).
      await prisma.$transaction([
        prisma.agentAttachment.delete({ where: { id: c.id } }),
        prisma.asset.delete({ where: { id: c.assetId } }),
      ]);
      deleted += 1;
    } catch (err) {
      console.error(
        `[attachment-cleanup] db delete failed for ${c.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.info(
    `[attachment-cleanup] done. deleted=${deleted} storageErrors=${storageErrors}`,
  );
}
