import { z } from 'zod';

import { defineTool } from '@getyn/ai';

/**
 * Phase 7 M2 — single trivial tool used to validate the runtime end
 * to end before any channel-specific work lands in M3 / M4.
 *
 * The agent calls this once early in every conversation. The handler
 * patches `state.goal`, which the M5 chat UI surfaces as a pill, and
 * (later) seeds the AgentConversation.goal column so the resume list
 * has a readable label.
 */
export const setGoalTool = defineTool({
  name: 'set_goal',
  description:
    "Capture the user's stated goal for this campaign in 1 sentence. Call this exactly once near the start of the conversation, as soon as you understand what they're trying to achieve. Examples: 'Drive Black Friday sales with a 30% discount.' or 'Re-engage subscribers who haven't opened anything in 90 days.'",
  inputSchema: z.object({
    goal: z
      .string()
      .trim()
      .min(4, 'Goal must be at least a few words.')
      .max(280, 'Goal must fit in a tweet.'),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    goal: z.string(),
  }),
  async handler(input, ctx) {
    ctx.updateState({ goal: input.goal });
    return { ok: true as const, goal: input.goal };
  },
});
