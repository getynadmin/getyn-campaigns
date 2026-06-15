import { z } from 'zod';

import { defineTool } from '@getyn/ai';

import { readEmailState } from './state';

export const updateBlockContentTool = defineTool({
  name: 'update_block_content',
  description:
    "Refine the content of one specific block in the design plan. Use this when the user asks for a tone tweak, a copy change, or to swap an image URL. Provide the entire replacement `content` object — partial merges aren't supported.",
  inputSchema: z.object({
    blockIndex: z.number().int().min(0),
    content: z.record(z.string(), z.unknown()),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    slug: z.string(),
  }),
  async handler(input, ctx) {
    const state = readEmailState(ctx.state);
    const plan = state.designPlan ?? [];
    if (input.blockIndex >= plan.length) {
      throw new Error(
        `Block index ${input.blockIndex} is out of range — the plan has ${plan.length} blocks.`,
      );
    }
    const next = plan.slice();
    const current = next[input.blockIndex];
    if (!current) {
      // Already guarded above, but keeps the type narrow.
      throw new Error('Block index missing.');
    }
    const updated: typeof current = { ...current, content: input.content };
    next[input.blockIndex] = updated;
    ctx.updateState({ designPlan: next });
    return { ok: true as const, slug: updated.slug };
  },
});
