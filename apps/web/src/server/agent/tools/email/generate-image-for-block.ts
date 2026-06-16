/**
 * Phase 7.2 — `generate_image_for_block` tool.
 *
 * DALL-E 3 generation, optionally style-inspired by an existing
 * attachment. The generated image lands in the `agent-attachments`
 * bucket as an `AgentAttachment` row with `isAiGenerated: true` in
 * `parsedContent`, so it flows through the same cleanup pipeline as
 * uploaded images. At finalize_draft time it gets copied to the
 * email-assets bucket along with regular attachments.
 *
 * Budgets enforced in this tool:
 *   - Max 3 generations per conversation
 *   - Conversation total cost cap ($0.50)
 *
 * Either one tripping returns a tool result with `error` set so the
 * agent can continue the conversation cleanly (no exception).
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  DalleGenerationError,
  computeDalleCost,
  defineTool,
  extractVisualStyleCues,
  generateImage,
} from '@getyn/ai';
import { prisma, withTenant } from '@getyn/db';
import { createClient } from '@supabase/supabase-js';

import { publicEnv, serverEnv } from '@/lib/env';
import { getAnthropicCredentials } from '@/server/integrations/anthropic';
import { getDalleCredentials } from '@/server/integrations/dalle';

import { readEmailState } from './state';

const BUCKET = 'agent-attachments';
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

/** Conversation cost cap matches the runner's COST_CAP_CENTS. */
const COST_CAP_USD = 0.5;
/** Hard ceiling — even if cost cap allows more, never generate >3 per
 *  conversation. Matches the spec. */
const MAX_GENERATIONS_PER_CONVO = 3;

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

interface VisualStyleCues {
  colors: string[];
  mood: string;
  composition: string;
  subject: string;
}

function isStyleCues(v: unknown): v is VisualStyleCues {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.colors) &&
    typeof o.mood === 'string' &&
    typeof o.composition === 'string' &&
    typeof o.subject === 'string'
  );
}

function cuesToPromptSuffix(cues: VisualStyleCues): string {
  const colors = cues.colors.length > 0 ? cues.colors.join(', ') : 'neutral';
  return `Visual style reference: mood=${cues.mood}, composition=${cues.composition}, colors=${colors}.`;
}

export const generateImageForBlockTool = defineTool({
  name: 'generate_image_for_block',
  description:
    'Generate a new image with OpenAI image generation (gpt-image-2) and place it into a block image placeholder. Use specific, descriptive prompts (e.g. "Professional product photo of a leather backpack on a wooden desk, soft natural lighting") — not vague ones. Avoid prompts asking the model to render text or logos. Optionally pass a referenceAttachmentId from the conversation manifest to inherit the visual style of an attached image. Budget: 3 generations per conversation.',
  inputSchema: z.object({
    blockIndex: z.number().int().min(0),
    placeholderKey: z.string().min(1),
    prompt: z.string().min(10).max(900),
    referenceAttachmentId: z.string().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    imageUrl: z.string().optional(),
    revisedPrompt: z.string().optional(),
    attachmentId: z.string().optional(),
    costUsd: z.number().optional(),
    generationsUsed: z.number().optional(),
    generationsRemaining: z.number().optional(),
  }),
  async handler(input, ctx) {
    if (!VALID_IMAGE_PLACEHOLDERS.has(input.placeholderKey)) {
      return {
        ok: false,
        error: `Unknown image placeholder "${input.placeholderKey}". Valid keys: ${[...VALID_IMAGE_PLACEHOLDERS].join(', ')}.`,
      };
    }
    const state = readEmailState(ctx.state);
    const plan = state.designPlan ?? [];
    if (input.blockIndex >= plan.length) {
      return {
        ok: false,
        error: `Block index ${input.blockIndex} is out of range — the plan has ${plan.length} blocks.`,
      };
    }
    const targetBlock = plan[input.blockIndex];
    if (!targetBlock) {
      return { ok: false, error: 'Block index missing.' };
    }

    // Per-conversation generation budget — count existing
    // AI-generated AgentAttachments in this conversation.
    const existingGenerations = await withTenant(ctx.tenantId, (tx) =>
      tx.agentConversationAttachment.count({
        where: {
          conversationId: ctx.conversationId,
          tenantId: ctx.tenantId,
          attachment: {
            attachmentType: 'IMAGE',
            // parsedContent stores { kind: 'image', data: { ..., isAiGenerated: true, generationPrompt: ... } }
            // The path filter checks data.isAiGenerated = true.
            parsedContent: { path: ['data', 'isAiGenerated'], equals: true },
          },
        },
      }),
    );
    if (existingGenerations >= MAX_GENERATIONS_PER_CONVO) {
      return {
        ok: false,
        error: `Image generation budget exhausted (${MAX_GENERATIONS_PER_CONVO}/${MAX_GENERATIONS_PER_CONVO} used). Use an attached image or proceed without.`,
        generationsUsed: existingGenerations,
        generationsRemaining: 0,
      };
    }

    // Resolve DALL-E credentials.
    const dalle = await getDalleCredentials();
    if (!dalle.apiKey || !dalle.enabled) {
      return {
        ok: false,
        error:
          'OpenAI image generation is not configured or not enabled for this workspace. An admin can turn it on in Admin → Global Integrations → AI LLMs.',
      };
    }

    // Cost cap check — pre-compute what this generation would cost.
    const projectedCost = computeDalleCost(dalle.defaultSize, dalle.defaultQuality);
    const convo = await prisma.agentConversation.findUnique({
      where: { id: ctx.conversationId },
      select: { costCents: true },
    });
    const currentUsd = (convo?.costCents ?? 0) / 100;
    if (currentUsd + projectedCost > COST_CAP_USD) {
      return {
        ok: false,
        error: `This generation ($${projectedCost.toFixed(2)}) would push the conversation past its $${COST_CAP_USD.toFixed(2)} cost limit (currently $${currentUsd.toFixed(2)}). Use an attached image or proceed without.`,
      };
    }

    // Resolve reference style cues, if any.
    let finalPrompt = input.prompt.trim();
    if (input.referenceAttachmentId) {
      const refRow = await withTenant(ctx.tenantId, (tx) =>
        tx.agentAttachment.findFirst({
          where: {
            id: input.referenceAttachmentId,
            tenantId: ctx.tenantId,
          },
          include: {
            asset: { select: { storagePath: true, mimeType: true } },
            conversations: {
              where: { conversationId: ctx.conversationId },
              select: { id: true },
            },
          },
        }),
      );
      if (
        refRow &&
        refRow.conversations.length > 0 &&
        refRow.attachmentType === 'IMAGE'
      ) {
        let cues: VisualStyleCues | null = isStyleCues(refRow.visualStyleCues)
          ? refRow.visualStyleCues
          : null;

        if (!cues) {
          // Lazily extract + cache. Download the (small) thumbnail
          // for the vision call, then write cues back.
          try {
            const supabase = getSupabase();
            const thumbPath = `${refRow.asset.storagePath}.thumb.webp`;
            const dl = await supabase.storage.from(BUCKET).download(thumbPath);
            if (!dl.error && dl.data) {
              const buf = Buffer.from(await dl.data.arrayBuffer());
              const anthropic = await getAnthropicCredentials();
              const result = await extractVisualStyleCues({
                imageBase64: buf.toString('base64'),
                mimeType: 'image/webp',
                apiKey: anthropic.apiKey ?? undefined,
              });
              if (!result.fallback) {
                cues = result.cues;
                await prisma.agentAttachment.update({
                  where: { id: refRow.id },
                  data: {
                    visualStyleCues: cues as unknown as object,
                  },
                });
              }
            }
          } catch {
            // Vision extraction is best-effort — proceed without
            // cues if it fails. Agent gets a less-styled image.
          }
        }

        if (cues) {
          finalPrompt = `${finalPrompt}. ${cuesToPromptSuffix(cues)}`;
        }
      }
    }

    // Run DALL-E.
    let generation: Awaited<ReturnType<typeof generateImage>>;
    try {
      generation = await generateImage({
        prompt: finalPrompt,
        apiKey: dalle.apiKey,
        model: dalle.model,
        size: dalle.defaultSize,
        quality: dalle.defaultQuality,
      });
    } catch (err) {
      if (err instanceof DalleGenerationError) {
        return { ok: false, error: `Image generation failed: ${err.message}` };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Image generation call failed.',
      };
    }

    // Upload to Storage. Path pattern keeps generated images
    // co-located with uploads for the same conversation.
    const assetId = randomUUID();
    const objectPath = `${ctx.tenantId}/${ctx.conversationId}/generated-${assetId}.png`;
    const supabase = getSupabase();
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, generation.imageBytes, {
        contentType: 'image/png',
        upsert: false,
      });
    if (upErr) {
      return {
        ok: false,
        error: `Could not upload generated image: ${upErr.message}`,
      };
    }

    // Persist Asset + AgentAttachment + ConversationAttachment in
    // one tx. parsedAt is set immediately because there's no
    // background parsing for AI-generated images — DALL-E already
    // produced PNG bytes we trust. AI-generated metadata goes into
    // parsedContent's `data` slot so the cleanup cron treats it
    // identically to uploaded images.
    const attachment = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          tenantId: ctx.tenantId,
          fileName: `dalle-${assetId}.png`,
          mimeType: 'image/png',
          sizeBytes: generation.imageBytes.byteLength,
          storagePath: objectPath,
        },
      });
      const att = await tx.agentAttachment.create({
        data: {
          tenantId: ctx.tenantId,
          assetId: asset.id,
          attachmentType: 'IMAGE',
          parsedContent: {
            kind: 'image',
            data: {
              width: parseInt(generation.size.split('x')[0] ?? '1024', 10),
              height: parseInt(generation.size.split('x')[1] ?? '1024', 10),
              thumbnailPath: '',
              format: 'png',
              isAiGenerated: true,
              generationPrompt: input.prompt,
              revisedPrompt: generation.revisedPrompt,
              dalleSize: generation.size,
              dalleQuality: generation.quality,
              dalleModel: generation.model,
              referenceAttachmentId: input.referenceAttachmentId ?? null,
            },
          },
          parsedAt: new Date(),
          aiSummary: `AI-generated image (${generation.model}). Prompt: "${input.prompt}".`,
          aiSummaryModel: generation.model,
          aiSummaryGeneratedAt: new Date(),
          // Pinned (NULL expiresAt) — this image is going into the
          // finalized draft, so cleanup should not touch it.
        },
      });
      await tx.agentConversationAttachment.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          agentAttachmentId: att.id,
        },
      });
      return att;
    });

    // Bump the conversation's cost ledger.
    const generationCents = Math.round(generation.costUsd * 100);
    await prisma.agentConversation.update({
      where: { id: ctx.conversationId },
      data: { costCents: { increment: generationCents } },
    });

    // Mint a (24h) signed URL for the design plan. Finalize copies
    // it to the email-assets bucket with a permanent URL.
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) {
      return {
        ok: false,
        error: `Generated and stored image but could not mint URL: ${signErr?.message ?? 'unknown'}`,
      };
    }

    const next = plan.slice();
    next[input.blockIndex] = {
      ...targetBlock,
      content: {
        ...targetBlock.content,
        [input.placeholderKey]: signed.signedUrl,
      },
    };
    ctx.updateState({ designPlan: next });

    return {
      ok: true,
      imageUrl: signed.signedUrl,
      revisedPrompt: generation.revisedPrompt,
      attachmentId: attachment.id,
      costUsd: generation.costUsd,
      generationsUsed: existingGenerations + 1,
      generationsRemaining: MAX_GENERATIONS_PER_CONVO - (existingGenerations + 1),
    };
  },
});
