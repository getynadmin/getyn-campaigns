/**
 * Phase 7 M4 — draft_new_template tool.
 *
 * When the tenant doesn't have an approved template that fits, the
 * agent can author one inline. We reuse the Phase 4 M7
 * `draftWhatsAppTemplate` Claude pipeline (same prompt, same
 * validation), persist the result as a DRAFT WhatsAppTemplate row,
 * and stash it in conversation state.
 *
 * The campaign created at finalize_draft references this row directly.
 * The user reviews + submits for Meta approval in the existing
 * /t/[slug]/whatsapp/templates editor; once approved, the campaign
 * can dispatch.
 */
import { z } from 'zod';

import { defineTool, draftWhatsAppTemplate } from '@getyn/ai';
import { WATemplateStatus, prisma, withTenant } from '@getyn/db';
import type { Prisma, WATemplateCategory } from '@getyn/db';

import type { WhatsAppAgentTemplateRef } from './state';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

export const draftNewTemplateTool = defineTool({
  name: 'draft_new_template',
  description:
    "Author a new WhatsApp template inline. Use when none of the tenant's existing approved templates fit the campaign. Returns the new template's id; the user will need to review and submit it to Meta for approval before the campaign can send. The campaign created at finalize_draft references the new template — sending starts automatically once Meta approves.",
  inputSchema: z.object({
    brief: z
      .string()
      .trim()
      .min(8)
      .max(800)
      .describe(
        'Plain-language description of what the template should say, e.g. "Order shipped notification with tracking link" or "Welcome message with the recipient first name".',
      ),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
    language: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .default('en_US')
      .describe('Language code, e.g. en_US, en_GB, hi, es.'),
    tone: z
      .enum(['transactional', 'friendly', 'urgent', 'formal'])
      .default('friendly'),
    /** Short slug for the template — must be unique per WA account. */
    templateName: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'Template name must be lowercase letters / digits / underscores, starting with a letter (Meta requirement).',
      ),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    templateId: z.string(),
    status: z.literal('DRAFT'),
    bodyText: z.string(),
    variableCount: z.number(),
    issues: z.array(
      z.object({
        message: z.string(),
        path: z.string().optional(),
      }),
    ),
    awaitingMetaApproval: z.literal(true),
  }),
  async handler(input, ctx) {
    const account = await prisma.whatsAppAccount.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!account) {
      throw new Error(
        'No connected WhatsApp account in this workspace. Connect one in Settings → Channels first.',
      );
    }

    // Brand context for the Claude system prompt.
    const brand = await withTenant(ctx.tenantId, (tx) =>
      tx.tenantBrandProfile.findUnique({
        where: { tenantId: ctx.tenantId },
        select: { brandName: true, brandDescription: true },
      }),
    );

    // Run the Phase 4 M7 drafting pipeline.
    const result = await draftWhatsAppTemplate({
      brief: input.brief,
      category: input.category,
      language: input.language,
      tone: input.tone,
      tenantName: brand?.brandName,
      tenantAbout: brand?.brandDescription ?? undefined,
    });

    if (!result.components) {
      throw new Error(
        `Couldn't compose a valid template from that brief: ${result.issues.map((i) => i.message).join('; ')}. Try a more specific brief or use list_approved_templates to pick an existing one.`,
      );
    }

    // Persist as DRAFT so the user reviews in the editor + submits to Meta.
    let created;
    try {
      created = await withTenant(ctx.tenantId, (tx) =>
        tx.whatsAppTemplate.create({
          data: {
            tenantId: ctx.tenantId,
            whatsAppAccountId: account.id,
            name: slugify(input.templateName),
            language: input.language,
            category: input.category as WATemplateCategory,
            status: WATemplateStatus.DRAFT,
            components: result.components as unknown as Prisma.JsonArray,
            createdByUserId: ctx.userId,
          },
        }),
      );
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new Error(
          `A template named ${slugify(input.templateName)} already exists for that language. Pick a different templateName.`,
        );
      }
      throw err;
    }

    const bodyText = extractBody(result.components);
    const variableCount = countVariables(bodyText);

    const ref: WhatsAppAgentTemplateRef = {
      templateId: created.id,
      templateName: created.name,
      language: created.language,
      status: 'DRAFT',
      variableCount,
      bodyText,
    };
    ctx.updateState({
      template: ref,
      templateVariables: [],
    });

    return {
      ok: true as const,
      templateId: created.id,
      status: 'DRAFT' as const,
      bodyText,
      variableCount,
      issues: result.issues.map((i) => ({
        message: i.message,
        ...(i.path ? { path: i.path } : {}),
      })),
      awaitingMetaApproval: true as const,
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
