import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import { prisma, WATemplateStatus } from '@getyn/db';

/**
 * Read-only — returns the tenant's approved WhatsApp templates so
 * Claude can pick one with `pick_existing_template`. Called as a tool
 * (rather than baked into the system prompt) because the list can be
 * large and the agent only needs it when actively picking.
 */
export const listApprovedTemplatesTool = defineTool({
  name: 'list_approved_templates',
  description:
    'List the tenant\'s approved WhatsApp templates so you can pick one with pick_existing_template. Returns name, language, category, and the body text with {{N}} variable tokens.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        language: z.string(),
        category: z.string(),
        bodyText: z.string(),
        variableCount: z.number(),
      }),
    ),
  }),
  async handler(_input, ctx) {
    const rows = await prisma.whatsAppTemplate.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: WATemplateStatus.APPROVED,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 40,
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        components: true,
      },
    });
    const templates = rows.map((r) => {
      const body = extractBody(r.components);
      return {
        id: r.id,
        name: r.name,
        language: r.language,
        category: r.category as string,
        bodyText: body,
        variableCount: countVariables(body),
      };
    });
    return { templates };
  },
});

/** Extract the BODY component's text from a Meta-shaped components array. */
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
