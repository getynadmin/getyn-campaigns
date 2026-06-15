import { z } from 'zod';

import { defineTool } from '@getyn/ai';

import { readWaState } from './state';

const variableSchema = z.object({
  /** The variable index in the template body. {{1}} is index 1. */
  index: z.number().int().min(1).max(10),
  type: z.enum(['static', 'merge']),
  /** For 'static', the literal value. For 'merge', a contact field
   *  reference like "contact.firstName" or "contact.email". */
  value: z.string().trim().min(1).max(500),
});

/**
 * Fill in the {{1}}, {{2}}, ... placeholders in the chosen template's
 * body. Each value is either a literal ("Welcome to Acme") or a
 * contact merge tag ("contact.firstName") resolved per-recipient at
 * dispatch time.
 */
export const setTemplateVariablesTool = defineTool({
  name: 'set_template_variables',
  description:
    'Fill in the template variables in {{1}}, {{2}}, ... slots. Each value is either a literal string or a contact merge tag ("contact.firstName"). Call this after picking a template — the conversation state knows how many variables are required.',
  inputSchema: z.object({
    values: z
      .array(variableSchema)
      .min(0)
      .max(10)
      .describe(
        'One entry per template variable, indexed by position ({{1}} → index 1).',
      ),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    filled: z.number(),
    expected: z.number(),
  }),
  async handler(input, ctx) {
    const state = readWaState(ctx.state);
    if (!state.template) {
      throw new Error(
        'Pick or draft a template first (pick_existing_template / draft_new_template).',
      );
    }
    const expected = state.template.variableCount;
    if (input.values.length !== expected) {
      throw new Error(
        `Template ${state.template.templateName} expects ${expected} variable${expected === 1 ? '' : 's'}; you provided ${input.values.length}.`,
      );
    }
    // Verify every index 1..expected is covered exactly once.
    const seen = new Set<number>();
    for (const v of input.values) {
      if (v.index < 1 || v.index > expected) {
        throw new Error(
          `Variable index ${v.index} is out of range (template has ${expected} variables).`,
        );
      }
      if (seen.has(v.index)) {
        throw new Error(`Variable index ${v.index} provided twice.`);
      }
      seen.add(v.index);
    }
    // Normalise: drop the index field and order by index, so the
    // resulting array aligns with whatsAppCampaignCreateSchema's
    // templateVariables shape ({{1}} first, {{2}} second, …).
    const ordered = input.values
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((v) => ({ type: v.type, value: v.value }));
    ctx.updateState({ templateVariables: ordered });
    return {
      ok: true as const,
      filled: ordered.length,
      expected,
    };
  },
});
