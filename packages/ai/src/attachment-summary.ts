/**
 * Phase 7.1 — Attachment summarizer.
 *
 * Single Haiku call per attachment. The summary lands in
 * `AgentAttachment.aiSummary` and gets folded into every subsequent
 * conversation turn's system prompt — never the raw file contents.
 * That's how we keep the $0.50/conversation cap viable for users who
 * upload multiple references.
 *
 * Cost cap: $0.05 per attachment. The Haiku ping price is ~$1/$5 per
 * million tokens at the time of writing — we cap inputs to ~30k chars
 * and ask for 2-5 sentences out, so a single call lands well under
 * the cap. If it would exceed, we skip with a stub summary; the agent
 * runtime tolerates `null`.
 */
import { computeCost, getAnthropicClient } from './client';

import type Anthropic from '@anthropic-ai/sdk';

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001' as const;

/** Haiku pricing per million tokens (USD). Conservative compared
 *  to published rates so we never silently blow through the cap. */
const HAIKU_INPUT_PER_M = 1.0;
const HAIKU_OUTPUT_PER_M = 5.0;

/** $0.05 per attachment — hard ceiling. */
const COST_CAP_USD = 0.05;

const SHARED_TAIL = `\n\nReply with just the summary — no preamble, no markdown, plain prose.`;

interface SummarizeImageInput {
  kind: 'image';
  /** Base64-encoded image bytes. The summarizer caller (worker) has
   *  the buffer in hand from the parse pipeline, so we inline it
   *  rather than re-fetch via signed URL. The agent runtime's vision
   *  tool (M2) is the path that uses signed URLs. */
  imageBase64: string;
  /** "image/png" | "image/jpeg" | "image/webp" — matches the
   *  Anthropic SDK's `media_type` field. */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

interface SummarizePdfInput {
  kind: 'pdf';
  /** First ~5000 chars of extracted text. */
  textHead: string;
  pageCount: number;
}

interface SummarizeSpreadsheetInput {
  kind: 'spreadsheet';
  columns: string[];
  sampleRows: Array<Record<string, string>>;
  rowCount: number;
}

interface SummarizeDocxInput {
  kind: 'docx';
  /** First ~2000 chars. */
  textHead: string;
  headings: string[];
  wordCount: number;
}

export type SummarizeInput =
  | SummarizeImageInput
  | SummarizePdfInput
  | SummarizeSpreadsheetInput
  | SummarizeDocxInput;

export interface SummarizeResult {
  /** Final summary, or a fallback stub on cost-cap / API failure. */
  summary: string;
  model: string;
  costUsd: number;
  /** True when we returned a stub instead of a Claude-generated
   *  string (cap hit, vision unavailable, etc.). */
  fallback: boolean;
  fallbackReason?: string;
}

function fallbackStub(input: SummarizeInput, reason: string): SummarizeResult {
  let summary: string;
  switch (input.kind) {
    case 'image':
      summary = 'Image attachment (no AI summary available).';
      break;
    case 'pdf':
      summary = `PDF document with ${input.pageCount} pages (no AI summary available).`;
      break;
    case 'spreadsheet':
      summary = `Spreadsheet with ${input.columns.length} columns and ${input.rowCount} rows: ${input.columns.slice(0, 6).join(', ')}.`;
      break;
    case 'docx':
      summary = `Document, ~${input.wordCount} words (no AI summary available).`;
      break;
  }
  return {
    summary,
    model: 'stub',
    costUsd: 0,
    fallback: true,
    fallbackReason: reason,
  };
}

function buildMessages(input: SummarizeInput): {
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
} {
  switch (input.kind) {
    case 'image':
      return {
        system:
          'You describe images for a marketing-campaign assistant. Focus on visual elements: dominant colors, layout style, photographic vs illustrated, mood, any visible text. 2-3 sentences.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mimeType,
                  data: input.imageBase64,
                },
              },
              {
                type: 'text',
                text: `Describe this image as design reference for a marketing campaign.${SHARED_TAIL}`,
              },
            ],
          },
        ],
        maxTokens: 256,
      };
    case 'pdf':
      return {
        system:
          'You summarize documents for a marketing-campaign assistant. If the document looks like brand guidelines, design references, or marketing copy, focus on style/voice/visual cues. Otherwise summarize content + tone. 4-5 sentences.',
        messages: [
          {
            role: 'user',
            content: `Document has ${input.pageCount} pages. First excerpt:\n\n${input.textHead}${SHARED_TAIL}`,
          },
        ],
        maxTokens: 400,
      };
    case 'spreadsheet': {
      const head = input.sampleRows.slice(0, 5).map((r) => JSON.stringify(r)).join('\n');
      return {
        system:
          'You describe spreadsheets for a marketing-campaign assistant. Identify what kind of records this looks like (people, businesses, products, events) and call out columns that look like email, phone, name, status, dates. 2-3 sentences.',
        messages: [
          {
            role: 'user',
            content: `Columns: ${input.columns.join(', ')}\nFirst 5 rows:\n${head}${SHARED_TAIL}`,
          },
        ],
        maxTokens: 256,
      };
    }
    case 'docx':
      return {
        system:
          'You summarize documents for a marketing-campaign assistant. Focus on content and tone of voice. 3-4 sentences.',
        messages: [
          {
            role: 'user',
            content: `Headings: ${input.headings.slice(0, 10).join(' | ')}\nOpening:\n${input.textHead}${SHARED_TAIL}`,
          },
        ],
        maxTokens: 320,
      };
  }
}

function haikuCost(inputTokens: number, outputTokens: number) {
  const usd =
    (inputTokens / 1_000_000) * HAIKU_INPUT_PER_M +
    (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_M;
  // Reuse the existing rounding helper for consistency.
  const totals = computeCost(inputTokens, outputTokens);
  return { ...totals, costUsd: Math.round(usd * 1_000_000) / 1_000_000 };
}

/**
 * Run the summarizer. Returns a fallback stub on any error — never
 * throws. Callers should still record the result on the attachment
 * row (the `fallback` flag tells the agent it's working from a stub).
 */
export async function summarizeAttachment(
  input: SummarizeInput,
  opts: { apiKey?: string } = {},
): Promise<SummarizeResult> {
  let client: Anthropic;
  try {
    client = getAnthropicClient(opts.apiKey);
  } catch (err) {
    return fallbackStub(
      input,
      `Anthropic client unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { system, messages, maxTokens } = buildMessages(input);
  try {
    const resp = await client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    const cost = haikuCost(resp.usage.input_tokens, resp.usage.output_tokens);
    if (cost.costUsd > COST_CAP_USD) {
      return fallbackStub(
        input,
        `Cost cap exceeded ($${cost.costUsd.toFixed(4)} > $${COST_CAP_USD}).`,
      );
    }
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) {
      return fallbackStub(input, 'Empty response from Claude.');
    }
    return {
      summary: text,
      model: SUMMARY_MODEL,
      costUsd: cost.costUsd,
      fallback: false,
    };
  } catch (err) {
    return fallbackStub(
      input,
      `Anthropic call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
