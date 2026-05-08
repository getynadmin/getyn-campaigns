/**
 * Phase 4 M7 — AI WhatsApp template drafting.
 *
 * Asks Claude to produce a TemplateDraft from a tenant's brief, then
 * validates the JSON against templateComponentsSchema +
 * validateForCategory. On schema failure, retries once with the
 * issues fed back as additional constraints. After two attempts we
 * return the latest attempt + the issue list for the user to fix.
 *
 * Output shape mirrors the Meta-API components Json so the editor
 * can drop the result straight into the form.
 */
import {
  templateComponentsSchema,
  validateForCategory,
  type TemplateComponents,
  type TemplateDraft,
} from '@getyn/types';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

export interface DraftRequest {
  /** Tenant's brief, e.g. "Order shipped notification with tracking link". */
  brief: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string; // ISO, e.g. en_US, hi
  /** 'transactional' | 'friendly' | 'urgent' | 'formal' */
  tone: 'transactional' | 'friendly' | 'urgent' | 'formal';
  /** Tenant business context — feeds into the system prompt. */
  tenantName?: string;
  tenantAbout?: string;
}

export interface DraftResult {
  /** Best attempt — may be `null` if Claude returned unparseable text. */
  components: TemplateComponents | null;
  /** Plain-language explanation of the design choices. */
  rationale: string;
  /** Schema + editorial issues found on the final attempt. */
  issues: Array<{ message: string; path?: string }>;
  /** Token usage + cost across all attempts (for AiGeneration audit). */
  cost: ReturnType<typeof computeCost>;
  /** Number of attempts made (1 or 2). */
  attempts: number;
  /** Raw final response text, surfaced for AiGeneration.response. */
  raw: string;
}

/**
 * Compose Claude's system prompt. We deliberately give it the
 * structural rules verbatim so the model can self-check before we
 * re-validate. Editorial rules (banned phrases per category) are
 * mentioned but not exhaustively listed — the validator catches
 * misses on the way out.
 */
function buildSystemPrompt(req: DraftRequest): string {
  const { category, language, tone, tenantName, tenantAbout } = req;
  const businessContext =
    tenantName || tenantAbout
      ? `\n\n# Business context\nName: ${tenantName ?? '(unknown)'}\nAbout: ${
          tenantAbout ?? '(unspecified)'
        }`
      : '';

  return `You are a WhatsApp Business template author. Produce a single template ready to submit to Meta's Cloud API.

# Hard rules (Meta will reject otherwise)
- Components in this exact order: HEADER → BODY → FOOTER → BUTTONS (any can be omitted; BODY is required).
- HEADER text: max 60 chars. Format must be one of TEXT | IMAGE | VIDEO | DOCUMENT. Prefer TEXT unless the brief explicitly needs media.
- BODY text: max 1024 chars. Variables {{1}}, {{2}}, ... must be sequential starting at {{1}}. Max 10 variables. Variables MUST be separated by literal text — never adjacent ({{1}}{{2}} is forbidden).
- FOOTER text: max 60 chars.
- BUTTONS: max 3. Each label max 25 chars.
- For BODY with N variables, supply example.body_text as [["v1", "v2", ...]] of length N.
- For HEADER format=TEXT containing {{1}}, supply example.header_text as ["v1"].

# Category: ${category}
${category === 'MARKETING' ? '- Promotional intent allowed. Avoid banned phrases like "click here", "free money", "guaranteed approval".' : ''}
${category === 'UTILITY' ? '- Strictly transactional. Avoid promotional language like "sale", "discount", "limited time".' : ''}
${category === 'AUTHENTICATION' ? '- OTP / verification only. Use {{1}} for the code. Buttons may only be COPY_CODE or URL.' : ''}

# Language: ${language}
Write the visible text in this language.

# Tone: ${tone}
${
    tone === 'transactional' ? 'Concise, neutral, no fluff.' :
    tone === 'friendly' ? 'Warm, approachable, conversational.' :
    tone === 'urgent' ? 'Direct, time-sensitive without being alarmist.' :
    'Professional, polite, formal register.'
  }
${businessContext}

# Output format
Reply with EXACTLY this JSON shape — no prose, no markdown fences, just the JSON object:

{
  "components": [...components matching Meta's TemplateComponent shape...],
  "rationale": "A short paragraph explaining why this design serves the brief."
}

Validate everything against the rules above before responding.`;
}

function buildUserPrompt(req: DraftRequest, retryHints: string[]): string {
  let msg = `Draft a template for: ${req.brief}`;
  if (retryHints.length > 0) {
    msg +=
      '\n\nYour previous draft had these issues. Fix all of them in this attempt:\n- ' +
      retryHints.join('\n- ');
  }
  return msg;
}

/**
 * Strip code fences if Claude added any despite the system prompt
 * forbidding them. Belt-and-braces — past models sometimes wrap.
 */
function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

interface ParsedResponse {
  components: unknown;
  rationale: string;
}

function tryParse(raw: string): ParsedResponse | null {
  try {
    const parsed = JSON.parse(unwrapJson(raw));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'components' in parsed &&
      'rationale' in parsed
    ) {
      return parsed as ParsedResponse;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Drive Claude with up to 2 attempts. Returns the best result we have
 * — even on schema-fail we surface the latest draft so the editor can
 * pre-populate and the user can fix from there.
 */
export async function draftWhatsAppTemplate(
  req: DraftRequest,
): Promise<DraftResult> {
  const client = getAnthropicClient();
  const systemPrompt = buildSystemPrompt(req);

  let lastRaw = '';
  let lastParsed: ParsedResponse | null = null;
  let lastIssues: Array<{ message: string; path?: string }> = [];
  let totalIn = 0;
  let totalOut = 0;
  let attempt = 0;
  let retryHints: string[] = [];

  while (attempt < 2) {
    attempt += 1;
    const resp = await client.messages.create({
      model: ACTIVE_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        { role: 'user', content: buildUserPrompt(req, retryHints) },
      ],
    });
    totalIn += resp.usage.input_tokens;
    totalOut += resp.usage.output_tokens;

    // Anthropic's content is an array of blocks; we expect one text block.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    lastRaw = text;
    const parsed = tryParse(text);
    lastParsed = parsed;

    if (!parsed) {
      lastIssues = [
        {
          message: 'AI response was not valid JSON. Tightening retry...',
        },
      ];
      retryHints = ['Output ONLY the JSON object — no prose, no fences.'];
      continue;
    }

    const schemaResult = templateComponentsSchema.safeParse(parsed.components);
    if (!schemaResult.success) {
      lastIssues = schemaResult.error.issues.map((i) => ({
        message: i.message,
        path: i.path.join('.'),
      }));
      retryHints = lastIssues.map((i) => i.message);
      continue;
    }

    // Schema valid — now editorial check (soft warnings; we don't retry on these).
    const draft: TemplateDraft = {
      name: 'placeholder', // not part of the AI output
      language: req.language,
      category: req.category,
      components: schemaResult.data,
    };
    const editorial = validateForCategory(draft);
    lastIssues = editorial.map((e) => ({
      message: e.message,
      path: e.path,
    }));
    return {
      components: schemaResult.data,
      rationale: parsed.rationale,
      issues: lastIssues,
      cost: computeCost(totalIn, totalOut),
      attempts: attempt,
      raw: text,
    };
  }

  // Both attempts failed schema. Return what we have.
  return {
    components:
      lastParsed && Array.isArray(lastParsed.components)
        ? // Coerce — caller knows it's untrusted because issues is non-empty.
          (lastParsed.components as unknown as TemplateComponents)
        : null,
    rationale: lastParsed?.rationale ?? '',
    issues: lastIssues,
    cost: computeCost(totalIn, totalOut),
    attempts: attempt,
    raw: lastRaw,
  };
}

// Anthropic SDK type re-export so callers don't need to import the SDK
// directly just for TextBlock narrowing in tests.
import type Anthropic from '@anthropic-ai/sdk';
