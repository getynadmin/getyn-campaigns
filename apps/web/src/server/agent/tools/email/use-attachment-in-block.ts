/**
 * Phase 7.2 — `use_attachment_in_block` tool.
 *
 * Places an existing IMAGE-type attachment directly into a block's
 * image placeholder. Cheap — no external API call, just a signed URL
 * mint. At finalize_draft time the URL is rewritten to a permanent
 * email-assets bucket copy.
 */
import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import { prisma, withTenant } from '@getyn/db';
import { createClient } from '@supabase/supabase-js';

import { publicEnv, serverEnv } from '@/lib/env';

import { readEmailState } from './state';

const BUCKET = 'agent-attachments';
/** Long enough that finalize_draft (called minutes-to-hours later)
 *  can copy the asset to email-assets. The 1-year permanence is
 *  established by the finalize step, not by this URL. */
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60; // 24h

const VALID_IMAGE_PLACEHOLDERS = new Set([
  'image_url',
  'icon_1',
  'icon_2',
  'icon_3',
  'logo_url',
]);

function getSupabase() {
  return createClient(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export const useAttachmentInBlockTool = defineTool({
  name: 'use_attachment_in_block',
  description:
    'Place an existing attached image into a block image placeholder. Use this when the user attached a relevant image and you want it on the email directly (e.g. a logo, product photo, hero shot). attachmentId comes from the "Files attached in this conversation" manifest in your system context.',
  inputSchema: z.object({
    blockIndex: z.number().int().min(0),
    placeholderKey: z
      .string()
      .min(1)
      .describe(
        'Image placeholder key on the target block, e.g. image_url, icon_1, logo_url.',
      ),
    attachmentId: z.string().min(1),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    slug: z.string(),
    placeholderKey: z.string(),
    fileName: z.string(),
  }),
  async handler(input, ctx) {
    if (!VALID_IMAGE_PLACEHOLDERS.has(input.placeholderKey)) {
      throw new Error(
        `Unknown image placeholder "${input.placeholderKey}". Valid keys: ${[...VALID_IMAGE_PLACEHOLDERS].join(', ')}.`,
      );
    }
    const state = readEmailState(ctx.state);
    const plan = state.designPlan ?? [];
    if (input.blockIndex >= plan.length) {
      throw new Error(
        `Block index ${input.blockIndex} is out of range — the plan has ${plan.length} blocks.`,
      );
    }
    const current = plan[input.blockIndex];
    if (!current) throw new Error('Block index missing.');

    // Tenant-scoped attachment lookup. RLS enforces the same; the
    // explicit tenantId guard is belt-and-braces.
    const row = await withTenant(ctx.tenantId, (tx) =>
      tx.agentAttachment.findFirst({
        where: { id: input.attachmentId, tenantId: ctx.tenantId },
        include: {
          asset: { select: { storagePath: true, fileName: true } },
          conversations: {
            where: { conversationId: ctx.conversationId },
            select: { id: true },
          },
        },
      }),
    );
    if (!row) {
      throw new Error(
        `Attachment ${input.attachmentId} not found in this workspace.`,
      );
    }
    if (row.conversations.length === 0) {
      throw new Error(
        `Attachment ${input.attachmentId} is not part of this conversation.`,
      );
    }
    if (row.attachmentType !== 'IMAGE') {
      throw new Error(
        `Attachment ${input.attachmentId} is a ${row.attachmentType}, not an image — cannot use as a block image.`,
      );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.asset.storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      throw new Error(
        `Could not mint signed URL for attachment: ${error?.message ?? 'unknown error'}`,
      );
    }

    const next = plan.slice();
    next[input.blockIndex] = {
      ...current,
      content: {
        ...current.content,
        [input.placeholderKey]: data.signedUrl,
      },
    };
    ctx.updateState({ designPlan: next });

    // Pin the attachment — remove its expiry so the cleanup cron
    // doesn't sweep it before finalize_draft copies it.
    await prisma.agentAttachment.update({
      where: { id: row.id },
      data: { expiresAt: null },
    });

    return {
      ok: true as const,
      slug: current.slug,
      placeholderKey: input.placeholderKey,
      fileName: row.asset.fileName,
    };
  },
});
