import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import { prisma } from '@getyn/db';

import { readEmailState } from './state';

/**
 * The agent's first cut at the visual structure. The block list is
 * an ordered sequence; the composer assembles them into Unlayer rows
 * top-down. The `content` map keys must match the block template's
 * placeholders (the system prompt enumerates available blocks; the
 * agent reads placeholder lists from the catalog tool below if it
 * needs to).
 */
export const proposeDesignPlanTool = defineTool({
  name: 'propose_design_plan',
  description:
    "Lay out the campaign as an ordered list of blocks from the email block library. Each block needs a slug (from the system prompt's catalog) and a content object filling in the {{placeholder}} slots. Include a footer block — the composer auto-injects footer_minimal if you forget. Don't include more than 12 blocks.",
  inputSchema: z.object({
    blocks: z
      .array(
        z.object({
          slug: z.string().trim().min(1).max(80),
          content: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1)
      .max(12),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    blockCount: z.number(),
    unknownSlugs: z.array(z.string()),
  }),
  async handler(input, ctx) {
    // Validate every slug exists. Don't fail the whole plan on one
    // bad slug — return them in unknownSlugs so the model can correct
    // with update_block_content or another call.
    const slugs = Array.from(new Set(input.blocks.map((b) => b.slug)));
    const known = await prisma.emailBlockTemplate.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true },
    });
    const knownSet = new Set(known.map((k) => k.slug));
    const unknownSlugs = slugs.filter((s) => !knownSet.has(s));
    if (unknownSlugs.length === slugs.length) {
      throw new Error(
        `None of the proposed slugs match the catalog: ${unknownSlugs.join(', ')}. See the system prompt for available blocks.`,
      );
    }
    const cleaned = input.blocks.filter((b) => knownSet.has(b.slug));
    const existing = readEmailState(ctx.state);
    ctx.updateState({
      designPlan: cleaned.map((b) => ({ slug: b.slug, content: b.content })),
      // Drop any image-requests tied to the old plan — block indices
      // are no longer valid.
      imageRequests: existing.imageRequests ? [] : undefined,
    });
    return {
      ok: true as const,
      blockCount: cleaned.length,
      unknownSlugs,
    };
  },
});
