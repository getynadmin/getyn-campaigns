/**
 * In-app Help assistant — answers "how do I…?" questions about the
 * Getyn Campaigns product and, when appropriate, cites one or two
 * docs articles by slug from a caller-supplied catalogue.
 *
 * Shape mirrors the other @getyn/ai modules: Zod-validated response,
 * token/cost accounting returned alongside the answer.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

export type HelpChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type HelpDoc = {
  slug: string;
  title: string;
  category: string;
};

export interface HelpAskRequest {
  question: string;
  history: HelpChatMessage[];
  availableDocs: HelpDoc[];
}

const helpResponseSchema = z.object({
  answer: z.string().min(1).max(4000),
  citations: z
    .array(z.object({ slug: z.string(), title: z.string() }))
    .max(3)
    .default([]),
});

export type HelpAnswer = z.infer<typeof helpResponseSchema>;

export interface HelpAskResult extends HelpAnswer {
  cost: ReturnType<typeof computeCost>;
  raw: string;
}

function buildSystemPrompt(docs: HelpDoc[]): string {
  const docsBlock = docs
    .map((d) => `  - [${d.category}] ${d.title} (slug: "${d.slug}")`)
    .join('\n');
  return `You are the in-app help assistant for Getyn Campaigns, a multi-channel marketing SaaS (email, WhatsApp, SMS, automation, AI copilot).

You help users understand how to use the product. Answer concisely and in plain language — 1-4 short paragraphs is almost always enough. Do not invent features.

The product's main surfaces (use these names in your answers):
- Dashboard — usage + at-a-glance activity
- Campaigns — one-off email / WhatsApp sends with drag-drop editor, A/B subject lines, scheduling
- Templates — reusable designs (incl. "Generate with AI")
- Segments — rule-based contact filters (incl. AI Segment Agent from a brief)
- Contacts, Custom fields, Tags, Suppression, Email Verifier (Audience)
- Channels — Email (bring-your-own-domain via Resend), WhatsApp (bring-your-own WABA), SMS (Phase 6)
- Automation — Drip Campaigns, Email Agent, WhatsApp Agent, Approval Inbox
- Settings — My profile, Workspace, Brand, Team, Custom fields, Sending domains, Subscription, Billing, Themes
- Billing — monthly plan + per-100 extras for AI credits / WhatsApp msgs / SMS msgs; trial lifecycle; self-serve Upgrade modal

Available docs articles (cite by slug — never invent slugs):
${docsBlock}

Reply with ONLY a JSON object of this shape, no prose, no code fences:
{
  "answer": "<your answer in plain prose>",
  "citations": [ { "slug": "<slug from the list above>", "title": "<the matching title>" } ]
}

Rules:
- Write in plain prose. DO NOT use any markdown — no **bold**, no *italics*, no backticks, no headings, no bullet characters (- or *), no numbered lists like "1." or "2.". If you need to list steps, write them as separate short sentences on their own lines.
- Cite 0, 1 or 2 articles — only cite when the article genuinely covers the question. Zero citations is fine.
- Never invent a slug or title. Only use entries from the list above.
- If the question is off-topic (not about Getyn Campaigns), politely steer back and cite nothing.
- Never mention Claude, Anthropic or the underlying model — the assistant is called "Getyn AI".
- Keep the answer short. No preamble like "Great question!". No sign-off.`;
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

export async function helpAnswer(
  req: HelpAskRequest,
  opts: { apiKey?: string } = {},
): Promise<HelpAskResult> {
  const client = getAnthropicClient(opts.apiKey);
  const system = buildSystemPrompt(req.availableDocs);

  const trimmedHistory = req.history.slice(-8);
  const messages: Anthropic.MessageParam[] = [
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: req.question },
  ];

  const resp = await client.messages.create({
    model: ACTIVE_MODEL,
    max_tokens: 1200,
    system,
    messages,
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const cost = computeCost(resp.usage.input_tokens, resp.usage.output_tokens);

  // Try to parse structured JSON; if the model slipped and sent prose,
  // treat the whole thing as the answer with no citations rather than
  // failing the whole request.
  let parsed: HelpAnswer;
  try {
    const obj = JSON.parse(unwrapJson(text));
    parsed = helpResponseSchema.parse(obj);
    const validSlugs = new Set(req.availableDocs.map((d) => d.slug));
    parsed.citations = parsed.citations.filter((c) => validSlugs.has(c.slug));
  } catch {
    parsed = { answer: text.trim() || 'Sorry — I did not understand that. Try rephrasing?', citations: [] };
  }

  return { ...parsed, cost, raw: text };
}
