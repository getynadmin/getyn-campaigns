import { z } from 'zod';

import { defineTool } from '@getyn/ai';

export const setSubjectLineTool = defineTool({
  name: 'set_subject_line',
  description:
    'Set the email subject and optional preheader (the gray preview text inboxes show next to the subject). Keep the subject under 60 chars and the preheader under 110.',
  inputSchema: z.object({
    subject: z.string().trim().min(2).max(140),
    preheader: z.string().trim().max(160).nullable().optional(),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    subject: z.string(),
    preheader: z.string().nullable(),
  }),
  async handler(input, ctx) {
    const subject = input.subject;
    const preheader = input.preheader ?? null;
    ctx.updateState({ subjectLine: { subject, preheader } });
    return { ok: true as const, subject, preheader };
  },
});
