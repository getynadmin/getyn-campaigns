import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import { prisma } from '@getyn/db';

import { cuidSchema } from '@getyn/types';

export const setAudienceTool = defineTool({
  name: 'set_audience',
  description:
    "Choose which existing segment to send this campaign to. Call this once you've discussed audience with the user. The segment id must match one listed in the system prompt — you can't invent segments.",
  inputSchema: z.object({
    segmentId: cuidSchema,
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    segmentName: z.string(),
  }),
  async handler(input, ctx) {
    const segment = await prisma.segment.findFirst({
      where: { id: input.segmentId, tenantId: ctx.tenantId },
      select: { id: true, name: true },
    });
    if (!segment) {
      throw new Error(
        `Segment ${input.segmentId} not found in this workspace. Pick from the list in the system prompt.`,
      );
    }
    ctx.updateState({
      audience: { segmentId: segment.id, segmentName: segment.name },
    });
    return { ok: true as const, segmentName: segment.name };
  },
});
