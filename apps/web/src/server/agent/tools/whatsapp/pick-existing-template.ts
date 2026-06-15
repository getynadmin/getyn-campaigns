import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import { prisma, WATemplateStatus } from '@getyn/db';
import { cuidSchema } from '@getyn/types';

import type { WhatsAppAgentTemplateRef } from './state';

/**
 * Lock in one of the tenant's approved templates. Call after
 * list_approved_templates to be sure the id is current.
 */
export const pickExistingTemplateTool = defineTool({
  name: 'pick_existing_template',
  description:
    "Pick one of the tenant's APPROVED templates by id (use list_approved_templates first to see the inventory). Stores the template in conversation state and tells you how many {{N}} variables you need to fill.",
  inputSchema: z.object({
    templateId: cuidSchema,
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    templateName: z.string(),
    variableCount: z.number(),
    bodyText: z.string(),
  }),
  async handler(input, ctx) {
    const tmpl = await prisma.whatsAppTemplate.findFirst({
      where: {
        id: input.templateId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        language: true,
        status: true,
        components: true,
      },
    });
    if (!tmpl) {
      throw new Error(
        `Template ${input.templateId} not found in this workspace.`,
      );
    }
    if (tmpl.status !== WATemplateStatus.APPROVED) {
      throw new Error(
        `Template ${tmpl.name} is ${tmpl.status} — only APPROVED templates can be used. Use draft_new_template to start a new one, or pick a different existing template.`,
      );
    }
    const bodyText = extractBody(tmpl.components);
    const variableCount = countVariables(bodyText);

    const ref: WhatsAppAgentTemplateRef = {
      templateId: tmpl.id,
      templateName: tmpl.name,
      language: tmpl.language,
      status: 'APPROVED',
      variableCount,
      bodyText,
    };
    ctx.updateState({
      template: ref,
      // New template = old variable values no longer apply.
      templateVariables: [],
    });
    return {
      ok: true as const,
      templateName: tmpl.name,
      variableCount,
      bodyText,
    };
  },
});

function extractBody(components: unknown): string {
  if (!Array.isArray(components)) return '';
  for (const c of components) {
    if (c && typeof c === 'object' && (c as { type?: string }).type === 'BODY') {
      const text = (c as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
  }
  return '';
}

function countVariables(text: string): number {
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return new Set(nums).size;
}
