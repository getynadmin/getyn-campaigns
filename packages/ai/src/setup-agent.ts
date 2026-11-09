/**
 * Agent Setup — turn an operator's short brief into drafted
 * `persona` + `goal` strings that prefill the WhatsApp / Email Agent
 * wizard. Deliberately returns ONLY those two fields — knowledge
 * URLs, schedule, templates and audience stay the operator's job.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

export type AgentChannel = 'email' | 'whatsapp';

export interface AgentSetupRequest {
  channel: AgentChannel;
  brief: string;
  tenantName?: string;
}

const agentSetupSchema = z.object({
  persona: z.string().min(10).max(2000),
  goal: z.string().min(10).max(2000),
});

export type AgentSetupDraft = z.infer<typeof agentSetupSchema>;

export interface AgentSetupResult extends AgentSetupDraft {
  cost: ReturnType<typeof computeCost>;
  attempts: number;
  raw: string;
}

function buildSystemPrompt(channel: AgentChannel, tenant?: string): string {
  const channelBlurb =
    channel === 'whatsapp'
      ? 'This is a WhatsApp agent. Keep messages short (WhatsApp reads like SMS), warm, and conversational. Avoid markdown — no **bold** or bullet characters; WhatsApp does not render them. The persona should hint at tone + voice, not specify exact message copy.'
      : 'This is an Email agent. Threaded, longer-form is fine (a short opening paragraph + 2–4 sentences max per reply). The persona should hint at tone + sender voice, not specify exact message copy.';

  return `You draft the Persona and Goal fields for a Getyn Campaigns autonomous ${channel} agent.

${channelBlurb}

Reply with ONLY a JSON object of this exact shape, no prose, no code fences:
{
  "persona": "<2-4 sentences describing who the agent is, tone, voice and style>",
  "goal": "<2-4 sentences describing what the agent should accomplish, who it's talking to, and what a win looks like>"
}

Rules:
- Write in plain prose. No markdown. No headings. No bullet points.
- Never invent product features that weren't in the brief. Stay faithful to what the operator described.
- The persona is about HOW the agent speaks and behaves; the goal is about WHAT it should achieve. Don't blur them.
- Neither field should quote the operator verbatim — rewrite in a natural product voice.
- Never mention Claude, Anthropic or the underlying model.${tenant ? `\n- The brand/tenant context is "${tenant}" — reference it naturally if the brief invites it.` : ''}`;
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

export async function draftAgentSetup(
  req: AgentSetupRequest,
  opts: { apiKey?: string } = {},
): Promise<AgentSetupResult> {
  const client = getAnthropicClient(opts.apiKey);
  const systemPrompt = buildSystemPrompt(req.channel, req.tenantName);

  let lastRaw = '';
  let totalIn = 0;
  let totalOut = 0;
  let attempt = 0;
  let retryHint: string | null = null;

  while (attempt < 2) {
    attempt += 1;
    const userMsg = retryHint
      ? `Brief: ${req.brief}\n\nYour previous draft was invalid: ${retryHint}. Return a clean JSON object.`
      : `Brief: ${req.brief}`;

    const resp = await client.messages.create({
      model: ACTIVE_MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
    totalIn += resp.usage.input_tokens;
    totalOut += resp.usage.output_tokens;

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    lastRaw = text;

    let parsed: unknown;
    try {
      parsed = JSON.parse(unwrapJson(text));
    } catch {
      retryHint = 'the response was not valid JSON';
      continue;
    }

    const result = agentSetupSchema.safeParse(parsed);
    if (!result.success) {
      retryHint = result.error.issues.map((i) => i.message).join('; ');
      continue;
    }

    return {
      ...result.data,
      cost: computeCost(totalIn, totalOut),
      attempts: attempt,
      raw: text,
    };
  }

  throw new Error(
    'Could not draft agent setup after 2 attempts. Try a longer or clearer brief.',
  );
}
