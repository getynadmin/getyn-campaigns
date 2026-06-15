import { z } from 'zod';

import { defineTool } from '@getyn/ai';

import { readEmailState, type PlanBlockState } from './state';

export const addBlockTool = defineTool({
  name: 'add_block',
  description:
    "Insert a new block into the design plan after the given index. Use afterIndex = -1 to add at the very top. Provide the slug + a `content` object filling in the block's placeholders.",
  inputSchema: z.object({
    afterIndex: z.number().int().min(-1),
    slug: z.string().trim().min(1).max(80),
    content: z.record(z.string(), z.unknown()),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    blockCount: z.number(),
  }),
  async handler(input, ctx) {
    const state = readEmailState(ctx.state);
    const plan = state.designPlan ?? [];
    const insertAt = Math.min(plan.length, Math.max(0, input.afterIndex + 1));
    const next = plan.slice();
    next.splice(insertAt, 0, {
      slug: input.slug,
      content: input.content,
    } satisfies PlanBlockState);
    ctx.updateState({ designPlan: next });
    return { ok: true as const, blockCount: next.length };
  },
});

export const removeBlockTool = defineTool({
  name: 'remove_block',
  description:
    'Remove one block from the design plan by index. Block order shifts up.',
  inputSchema: z.object({
    index: z.number().int().min(0),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    blockCount: z.number(),
  }),
  async handler(input, ctx) {
    const state = readEmailState(ctx.state);
    const plan = state.designPlan ?? [];
    if (input.index >= plan.length) {
      throw new Error(
        `Block index ${input.index} is out of range — the plan has ${plan.length} blocks.`,
      );
    }
    const next = plan.slice();
    next.splice(input.index, 1);
    ctx.updateState({ designPlan: next });
    return { ok: true as const, blockCount: next.length };
  },
});

export const reorderBlocksTool = defineTool({
  name: 'reorder_blocks',
  description:
    "Reorder the blocks. Provide the new order as a list of current indices — e.g. [2, 0, 1, 3] moves block 2 to the front.",
  inputSchema: z.object({
    newOrder: z.array(z.number().int().min(0)).min(1),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    blockCount: z.number(),
  }),
  async handler(input, ctx) {
    const state = readEmailState(ctx.state);
    const plan = state.designPlan ?? [];
    if (input.newOrder.length !== plan.length) {
      throw new Error(
        `newOrder length (${input.newOrder.length}) must match block count (${plan.length}).`,
      );
    }
    const seen = new Set(input.newOrder);
    if (seen.size !== input.newOrder.length) {
      throw new Error('newOrder contains duplicate indices.');
    }
    for (const idx of input.newOrder) {
      if (idx >= plan.length) {
        throw new Error(
          `newOrder references index ${idx} which is out of range.`,
        );
      }
    }
    const next = input.newOrder.map((i) => plan[i]);
    ctx.updateState({ designPlan: next });
    return { ok: true as const, blockCount: next.length };
  },
});
