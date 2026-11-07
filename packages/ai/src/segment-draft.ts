/**
 * Segment Agent — turn an operator's natural-language brief into a
 * validated `SegmentRules` tree.
 *
 * Mirrors the shape of `template-draft.ts`: up to 2 Claude attempts,
 * schema-validate with Zod, feed issues back on retry, and surface
 * cost + raw for the AiGeneration audit row.
 */
import type Anthropic from '@anthropic-ai/sdk';

import {
  SEGMENT_DATE_FIELDS,
  SEGMENT_ENUM_FIELDS,
  SEGMENT_TEXT_FIELDS,
  SEGMENT_TAG_FIELD,
  segmentRulesSchema,
  type SegmentRules,
} from '@getyn/types';

import { ACTIVE_MODEL, computeCost, getAnthropicClient } from './client';

export interface SegmentDraftRequest {
  brief: string;
  tenantName?: string;
  tags: Array<{ id: string; name: string }>;
  customFields: Array<{ id: string; key: string; label: string; type: string }>;
}

export interface SegmentDraftResult {
  rules: SegmentRules | null;
  rationale: string;
  issues: Array<{ message: string; path?: string }>;
  cost: ReturnType<typeof computeCost>;
  attempts: number;
  raw: string;
}

function buildSystemPrompt(req: SegmentDraftRequest): string {
  const tagsBlock =
    req.tags.length > 0
      ? req.tags
          .map((t) => `  - ${t.name} (id: ${t.id})`)
          .join('\n')
      : '  (none)';
  const customFieldsBlock =
    req.customFields.length > 0
      ? req.customFields
          .map(
            (f) =>
              `  - ${f.label} (ref: "custom_field:${f.id}", key: ${f.key}, type: ${f.type})`,
          )
          .join('\n')
      : '  (none)';

  return `You are a segment-rule compiler for a marketing CRM. Convert the user's brief into a JSON rule tree that selects the right contacts.

# Output shape (exact)
{
  "rules": {
    "kind": "group",
    "operator": "AND" | "OR",
    "children": [ <rule>, ... ]
  },
  "rationale": "One-sentence plain-English summary of the rule."
}

Every <rule> is either a nested group with the same shape, or a condition:
  { "kind": "condition", "field": "<field>", "operator": "<op>", "value": <value> }

# Allowed fields
- Text fields (operators: equals | not_equals | contains | not_contains | is_set | is_empty; value: string):
  ${SEGMENT_TEXT_FIELDS.join(', ')}
- Enum fields (operators: equals | not_equals | in | not_in):
  - email_status, sms_status, whatsapp_status: value in [SUBSCRIBED, UNSUBSCRIBED, PENDING, BOUNCED, BLOCKED]
  - source: value in [MANUAL, IMPORT, API, FORM, WEBHOOK, AGENT]
- Date fields (operators: within_last_days [value=int days] | before [value=ISO date] | after [value=ISO date] | is_set | is_empty):
  ${SEGMENT_DATE_FIELDS.join(', ')}
- Tag pseudo-field "${SEGMENT_TAG_FIELD}" (operators: equals | not_equals; value: Tag.id from the registry below).
- Custom fields (reference by "custom_field:<id>" — see registry below).

# Tag registry (use the id, not the name, in \`value\`)
${tagsBlock}

# Custom field registry
${customFieldsBlock}

# Hard rules
- Top-level MUST be { kind: "group", operator: ... }. A single condition becomes a group with one child.
- Max 3 levels of nesting, max 30 total conditions.
- Never invent fields, enum values, tag ids, or custom-field ids that aren't in the lists above.
- If the brief references a tag that doesn't exist in the registry, SKIP that constraint and note it in \`rationale\`.
- "is_set" / "is_empty" take no value; omit the key.
- Prefer the simplest rule that matches the intent.

# Output
Reply with ONLY the JSON object. No prose, no markdown fences.`;
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

interface ParsedResponse {
  rules: unknown;
  rationale: string;
}

function tryParse(raw: string): ParsedResponse | null {
  try {
    const parsed = JSON.parse(unwrapJson(raw));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'rules' in parsed &&
      'rationale' in parsed
    ) {
      return parsed as ParsedResponse;
    }
    return null;
  } catch {
    return null;
  }
}

export async function draftSegmentRules(
  req: SegmentDraftRequest,
  opts: { apiKey?: string } = {},
): Promise<SegmentDraftResult> {
  const client = getAnthropicClient(opts.apiKey);
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
    const userMsg =
      retryHints.length === 0
        ? `Brief: ${req.brief}`
        : `Brief: ${req.brief}\n\nYour previous draft had these issues — fix them all:\n- ${retryHints.join('\n- ')}`;

    const resp = await client.messages.create({
      model: ACTIVE_MODEL,
      max_tokens: 1500,
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
    const parsed = tryParse(text);
    lastParsed = parsed;

    if (!parsed) {
      lastIssues = [{ message: 'AI response was not valid JSON.' }];
      retryHints = ['Output ONLY the JSON object — no prose, no code fences.'];
      continue;
    }

    const schemaResult = segmentRulesSchema.safeParse(parsed.rules);
    if (!schemaResult.success) {
      lastIssues = schemaResult.error.issues.map((i) => ({
        message: i.message,
        path: i.path.join('.'),
      }));
      retryHints = lastIssues.map((i) =>
        i.path ? `${i.path}: ${i.message}` : i.message,
      );
      continue;
    }

    return {
      rules: schemaResult.data,
      rationale: parsed.rationale,
      issues: [],
      cost: computeCost(totalIn, totalOut),
      attempts: attempt,
      raw: text,
    };
  }

  return {
    rules: null,
    rationale: lastParsed?.rationale ?? '',
    issues: lastIssues,
    cost: computeCost(totalIn, totalOut),
    attempts: attempt,
    raw: lastRaw,
  };
}
