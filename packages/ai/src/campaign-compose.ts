/**
 * Campaign Composer — operator describes a goal, Claude proposes a full
 * email campaign draft: segment choice, name, subject, preview, from
 * name, and body copy.
 *
 * Returns a proposal — not a saved campaign. The UI lets the operator
 * review/edit before persisting. One Claude call, no retry; shape
 * validation is lenient so operators always get something to tweak.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

export interface CampaignComposeRequest {
  goal: string;
  tenantName?: string;
  defaultFromName?: string;
  defaultFromEmail?: string;
  segments: Array<{
    id: string;
    name: string;
    description?: string | null;
    memberCount?: number;
  }>;
}

export const campaignProposalSchema = z.object({
  suggestedSegmentId: z.string().nullable(),
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  subjectVariants: z.array(z.string().trim().min(1).max(200)).max(3).default([]),
  previewText: z.string().trim().max(150).default(''),
  fromName: z.string().trim().min(1).max(80),
  bodyText: z.string().trim().min(1).max(4000),
  rationale: z.string().trim().max(600).default(''),
});
export type CampaignProposal = z.infer<typeof campaignProposalSchema>;

export interface CampaignComposeResult {
  proposal: CampaignProposal | null;
  issues: Array<{ message: string; path?: string }>;
  cost: ReturnType<typeof computeCost>;
  raw: string;
}

function buildSystemPrompt(req: CampaignComposeRequest): string {
  const segmentsBlock =
    req.segments.length > 0
      ? req.segments
          .map(
            (s) =>
              `  - "${s.name}" (id: ${s.id}${
                typeof s.memberCount === 'number'
                  ? `, ~${s.memberCount} contacts`
                  : ''
              })${s.description ? ` — ${s.description}` : ''}`,
          )
          .join('\n')
      : '  (none — leave suggestedSegmentId null)';

  return `You are an email campaign composer for a marketing CRM. Given the operator's goal, propose a complete draft they can review and send.

# Output shape (exact JSON, no prose, no fences)
{
  "suggestedSegmentId": "<id from registry>" | null,
  "name": "Internal campaign name (<= 120 chars)",
  "subject": "Primary subject line (<= 80 chars, no emoji-only, concrete)",
  "subjectVariants": ["alt subject 1", "alt subject 2"],
  "previewText": "Inbox preview text (<= 90 chars, complements subject)",
  "fromName": "Sender display name",
  "bodyText": "Full email body as plain prose with line breaks. 80-200 words. Clear CTA. No placeholder brackets like [NAME] — use {{first_name}} if personalising.",
  "rationale": "One or two sentences explaining your choice of segment, subject, and angle."
}

# Available segments (pick the best fit by id, or null if none match)
${segmentsBlock}

# Defaults
- fromName: use "${req.defaultFromName ?? req.tenantName ?? 'Team'}" unless the goal implies otherwise.
- Tenant name: ${req.tenantName ?? '(unspecified)'}

# Rules
- bodyText is plain prose with blank lines between paragraphs, not HTML.
- Subject lines are concrete, not clickbait. No ALL CAPS, no "!!!".
- If the goal implies a segment that doesn't exist, set suggestedSegmentId = null and say so in rationale.
- subjectVariants are genuinely different angles, not slight rewordings.
- Never invent product details the goal doesn't mention.

Reply with ONLY the JSON object.`;
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

export async function composeCampaign(
  req: CampaignComposeRequest,
  opts: { apiKey?: string } = {},
): Promise<CampaignComposeResult> {
  const client = getAnthropicClient(opts.apiKey);
  const systemPrompt = buildSystemPrompt(req);

  const resp = await client.messages.create({
    model: ACTIVE_MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Goal: ${req.goal}` }],
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

  const result = campaignProposalSchema.safeParse(parsedRaw);
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
