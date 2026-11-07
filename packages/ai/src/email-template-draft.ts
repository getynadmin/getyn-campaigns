/**
 * Email template drafter — brief → {name, description, category,
 * subject, bodyHtml}. The bodyHtml is wrapped into a minimal Unlayer
 * design with one HTML block so the saved template renders in the
 * editor + preview + actual sends.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

export interface EmailTemplateDraftRequest {
  brief: string;
  tenantName?: string;
}

const CATEGORIES = [
  'WELCOME',
  'NEWSLETTER',
  'PROMOTIONAL',
  'ANNOUNCEMENT',
  'EVENT',
  'TRANSACTIONAL',
  'OTHER',
] as const;

export const emailTemplateProposalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(''),
  category: z.enum(CATEGORIES),
  subject: z.string().trim().min(1).max(200),
  previewText: z.string().trim().max(150).default(''),
  bodyHtml: z.string().trim().min(1).max(20000),
});
export type EmailTemplateProposal = z.infer<typeof emailTemplateProposalSchema>;

export interface EmailTemplateDraftResult {
  proposal: EmailTemplateProposal | null;
  issues: Array<{ message: string; path?: string }>;
  cost: ReturnType<typeof computeCost>;
  raw: string;
}

function buildSystemPrompt(req: EmailTemplateDraftRequest): string {
  return `You are an email template designer. Produce a reusable template as structured JSON. The HTML you write must render well across major email clients (Gmail, Outlook, Apple Mail).

# Output shape (exact JSON, no prose, no fences)
{
  "name": "Short template name (<= 60 chars, Title Case)",
  "description": "One-line summary of when to use this (<= 160 chars)",
  "category": "WELCOME" | "NEWSLETTER" | "PROMOTIONAL" | "ANNOUNCEMENT" | "EVENT" | "TRANSACTIONAL" | "OTHER",
  "subject": "Subject line default (<= 80 chars)",
  "previewText": "Inbox preview text (<= 90 chars)",
  "bodyHtml": "Full inline-styled HTML body — see rules below"
}

# bodyHtml rules
- Pure HTML string, NOT a document — no <html>, <head>, <body>, no <!doctype>.
- Use a single <div style="max-width:600px;margin:0 auto;padding:24px;font-family:-apple-system,BlueprintMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.55;"> as the wrapper.
- Use INLINE styles only (no <style> blocks, no classes).
- Headings: <h1 style="..."> / <h2 style="...">, with explicit font-size + margin.
- Buttons: an anchor styled as a button with padding, background-color, color, border-radius, text-decoration:none, display:inline-block.
- Dividers: <hr style="border:0;border-top:1px solid #eee;margin:24px 0;">.
- Personalisation: use {{first_name}} / {{email}} / {{tenantName}}. No square brackets.
- Clear CTA. 100-250 words total. Don't invent product details the brief doesn't mention.

# Category guidance
- WELCOME / TRANSACTIONAL: concise, plain, no promotional language.
- PROMOTIONAL / ANNOUNCEMENT: can include a hero heading + CTA.
- NEWSLETTER: multiple short sections with subheadings.
- EVENT: date/time/location block, RSVP CTA.

Tenant: ${req.tenantName ?? '(unspecified)'}

Reply with ONLY the JSON object.`;
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

export async function draftEmailTemplate(
  req: EmailTemplateDraftRequest,
  opts: { apiKey?: string } = {},
): Promise<EmailTemplateDraftResult> {
  const client = getAnthropicClient(opts.apiKey);
  const resp = await client.messages.create({
    model: ACTIVE_MODEL,
    max_tokens: 3000,
    system: buildSystemPrompt(req),
    messages: [{ role: 'user', content: `Brief: ${req.brief}` }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const cost = computeCost(resp.usage.input_tokens, resp.usage.output_tokens);

  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(unwrapJson(text));
  } catch {
    return {
      proposal: null,
      issues: [{ message: 'AI response was not valid JSON.' }],
      cost,
      raw: text,
    };
  }

  const result = emailTemplateProposalSchema.safeParse(parsedRaw);
  if (!result.success) {
    return {
      proposal: null,
      issues: result.error.issues.map((i) => ({
        message: i.message,
        path: i.path.join('.'),
      })),
      cost,
      raw: text,
    };
  }

  return { proposal: result.data, issues: [], cost, raw: text };
}

/**
 * Wrap a bodyHtml string into a minimal Unlayer design JSON — a single
 * HTML block on a single row. The editor loads this cleanly and lets
 * the user split it into real blocks later if they want.
 */
export function wrapHtmlInUnlayerDesign(bodyHtml: string): Record<string, unknown> {
  return {
    counters: { u_column: 1, u_row: 1, u_content_html: 1 },
    body: {
      id: 'ai-body',
      rows: [
        {
          id: 'ai-row-1',
          cells: [1],
          columns: [
            {
              id: 'ai-col-1',
              contents: [
                {
                  id: 'ai-html-1',
                  type: 'html',
                  values: {
                    html: bodyHtml,
                    hideDesktop: false,
                    displayCondition: null,
                    containerPadding: '10px',
                    _meta: { htmlID: 'u_content_html_1', htmlClassNames: 'u_content_html' },
                  },
                },
              ],
              values: {
                _meta: { htmlID: 'u_column_1', htmlClassNames: 'u_column' },
              },
            },
          ],
          values: {
            backgroundColor: '',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: false, center: true, cover: false },
            padding: '0px',
            _meta: { htmlID: 'u_row_1', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
      ],
      values: {
        backgroundColor: '#ffffff',
        backgroundImage: { url: '', fullWidth: true, repeat: false, center: true, cover: false },
        contentWidth: '600px',
        fontFamily: { label: 'Arial', value: 'arial,helvetica,sans-serif' },
        _meta: { htmlID: 'u_body', htmlClassNames: 'u_body' },
      },
    },
    schemaVersion: 6,
  };
}
