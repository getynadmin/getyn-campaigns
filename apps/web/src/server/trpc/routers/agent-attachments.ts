/**
 * Phase 7.1 — Attachment listing + signed-URL minting.
 *
 * The upload itself goes through a REST route (multipart-form-data is
 * cumbersome over tRPC). Everything afterwards — list the attachments
 * on a conversation, fetch a signed URL for preview / Claude-vision —
 * lives here.
 */
import { TRPCError } from '@trpc/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { prisma, withTenant } from '@getyn/db';
import { cuidSchema } from '@getyn/types';

import { publicEnv, serverEnv } from '@/lib/env';

import { createTRPCRouter, tenantProcedure } from '../trpc';

const BUCKET = 'agent-attachments';
/** Short TTL — the URL is consumed immediately by either the browser
 *  (preview) or Anthropic's vision endpoint (server-to-server fetch). */
const SIGNED_URL_TTL_SECONDS = 10 * 60;

function getSupabase() {
  return createClient(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export const agentAttachmentsRouter = createTRPCRouter({
  /**
   * List attachments on a conversation. Returns parse state so the UI
   * can render parsing spinners + summary previews.
   */
  list: tenantProcedure
    .input(z.object({ conversationId: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const convo = await tx.agentConversation.findUnique({
          where: { id: input.conversationId },
          select: { id: true, tenantId: true },
        });
        if (!convo || convo.tenantId !== tenantId) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Conversation not found.',
          });
        }
        const links = await tx.agentConversationAttachment.findMany({
          where: { conversationId: input.conversationId, tenantId },
          orderBy: { createdAt: 'asc' },
          include: {
            attachment: {
              include: {
                asset: {
                  select: {
                    id: true,
                    fileName: true,
                    mimeType: true,
                    sizeBytes: true,
                  },
                },
              },
            },
          },
        });
        return links.map((l) => ({
          id: l.attachment.id,
          assetId: l.attachment.assetId,
          attachmentType: l.attachment.attachmentType,
          fileName: l.attachment.asset.fileName,
          mimeType: l.attachment.asset.mimeType,
          sizeBytes: l.attachment.asset.sizeBytes,
          parsedAt: l.attachment.parsedAt,
          aiSummary: l.attachment.aiSummary,
          referencedAtMessageId: l.referencedAtMessageId,
          createdAt: l.createdAt,
          // parsedContent is intentionally NOT returned in the list
          // payload — the spreadsheet sample rows are large. The UI
          // fetches them on demand via .getParsed.
        }));
      });
    }),

  /**
   * Full parsed content for one attachment. Used by:
   *   - The CSV preview side panel
   *   - The Audience Agent's `inspect_spreadsheet` tool (M3)
   */
  getParsed: tenantProcedure
    .input(z.object({ attachmentId: cuidSchema }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.agentAttachment.findFirst({
          where: { id: input.attachmentId, tenantId },
          include: {
            asset: {
              select: { fileName: true, mimeType: true, sizeBytes: true },
            },
          },
        });
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Attachment not found.',
          });
        }
        return {
          id: row.id,
          attachmentType: row.attachmentType,
          fileName: row.asset.fileName,
          mimeType: row.asset.mimeType,
          sizeBytes: row.asset.sizeBytes,
          parsedAt: row.parsedAt,
          parsedContent: row.parsedContent,
          aiSummary: row.aiSummary,
        };
      });
    }),

  /**
   * Mint a short-lived signed URL for an attachment. Used by:
   *   - Browser preview (kind='original' or 'thumbnail')
   *   - Anthropic vision via the agent runtime (kind='original')
   *
   * TTL is 10 minutes — caller is expected to consume immediately and
   * never persist these. Persistence is via re-minting on demand.
   */
  getSignedUrl: tenantProcedure
    .input(
      z.object({
        attachmentId: cuidSchema,
        kind: z.enum(['original', 'thumbnail']).default('original'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await prisma.agentAttachment.findFirst({
        where: { id: input.attachmentId, tenantId },
        include: { asset: { select: { storagePath: true } } },
      });
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Attachment not found.',
        });
      }

      let path = row.asset.storagePath;
      if (input.kind === 'thumbnail') {
        // Convention: the parser worker writes the thumbnail alongside
        // the original at `${storagePath}.thumb.webp`. If the worker
        // hasn't run yet (parsedAt null), fall back to the original.
        if (row.parsedAt && row.attachmentType === 'IMAGE') {
          path = `${row.asset.storagePath}.thumb.webp`;
        }
      }

      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message ?? 'Failed to mint signed URL.',
        });
      }
      return {
        url: data.signedUrl,
        ttlSeconds: SIGNED_URL_TTL_SECONDS,
      };
    }),
});
