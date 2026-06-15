import { z } from 'zod';

import { defineTool } from '@getyn/ai';

import { readEmailState, type ImageRequest } from './state';

/**
 * Phase 7 M3 — request_image is a UI-coupled tool.
 *
 * In M5 the chat surface will catch this state-update and prompt the
 * user to upload or pick from the asset library. For M3 we just
 * record the request so the agent doesn't loop calling it; the
 * resolution happens out-of-band when the user provides the URL.
 *
 * The agent gets back a "pending — ask the user" string so it knows
 * to wait rather than treat the URL as immediately available.
 */
export const requestImageTool = defineTool({
  name: 'request_image',
  description:
    "Ask the user to provide an image for a specific block. Use when you need an image but don't have one yet. Returns a placeholder — you should pause and ask the user in natural language; the asset URL will arrive in a follow-up message.",
  inputSchema: z.object({
    blockIndex: z.number().int().min(0),
    description: z
      .string()
      .trim()
      .min(4)
      .max(280)
      .describe(
        'A short description of what the image should show (used by the UI prompt).',
      ),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    status: z.literal('pending_user_input'),
    placeholderUrl: z.string(),
  }),
  async handler(input, ctx) {
    const state = readEmailState(ctx.state);
    const requests = state.imageRequests ?? [];
    const next: ImageRequest[] = [
      // dedupe by blockIndex — keep the latest description
      ...requests.filter((r) => r.blockIndex !== input.blockIndex),
      { blockIndex: input.blockIndex, description: input.description },
    ];
    ctx.updateState({ imageRequests: next });
    return {
      ok: true as const,
      status: 'pending_user_input' as const,
      // A neutral hosted placeholder so the preview pane has SOMETHING
      // to render while the user provides the real image. Replaced at
      // finalize time when the user has resolved the request.
      placeholderUrl:
        'https://placehold.co/600x300/eeeeee/cccccc?text=Awaiting+image',
    };
  },
});
