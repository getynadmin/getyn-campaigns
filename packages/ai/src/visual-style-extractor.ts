/**
 * Phase 7.2 — Visual style cue extraction (Haiku vision).
 *
 * Run once per AgentAttachment used as a generation reference. The
 * structured output gets cached on `AgentAttachment.visualStyleCues`
 * so subsequent `generate_image_for_block` calls referencing the
 * same attachment reuse the shape without re-paying the vision call.
 *
 * Cost target: <$0.01 per extraction. Haiku vision on a 200×200
 * thumbnail (the same buffer the summarizer already uses) comes in
 * well under that.
 */
import { computeCost, getAnthropicClient } from './client';

import type Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001' as const;

const HAIKU_INPUT_PER_M = 1.0;
const HAIKU_OUTPUT_PER_M = 5.0;

export interface VisualStyleCues {
  /** Hex codes, lowercase, with the leading #. 3–6 dominant colors. */
  colors: string[];
  /** 1-2 word mood label, e.g. "warm minimalist", "energetic playful". */
  mood: string;
  /** Short phrase describing composition / framing — e.g. "centered
   *  product photo, soft natural lighting". */
  composition: string;
  /** Short phrase describing what's depicted — e.g. "leather backpack
   *  on a wooden surface". */
  subject: string;
}

export interface ExtractCuesResult {
  cues: VisualStyleCues;
  costUsd: number;
  model: string;
  /** True when JSON parsing failed and we returned a sentinel; the
   *  caller may want to skip caching. */
  fallback: boolean;
}

interface ExtractCuesArgs {
  imageBase64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  apiKey?: string;
}

function sentinel(reason: string): ExtractCuesResult {
  return {
    cues: {
      colors: [],
      mood: 'neutral',
      composition: 'unclear',
      subject: reason,
    },
    costUsd: 0,
    model: 'stub',
    fallback: true,
  };
}

const SYSTEM_PROMPT = `You extract visual style information from images for use as references when generating new marketing images.

Reply with EXACTLY this JSON shape — no prose, no markdown fences, just the JSON object:

{
  "colors": ["#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "mood": "1-2 word mood label",
  "composition": "short phrase about framing/lighting/style",
  "subject": "short phrase about what's depicted"
}

Constraints:
- colors: 3-6 hex codes, lowercase, with leading #
- All strings short — no full sentences
- No explanatory prose; just the JSON`;

function haikuCost(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * HAIKU_INPUT_PER_M +
    (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_M;
  // Round consistently with computeCost helper.
  void computeCost(inputTokens, outputTokens);
  return Math.round(usd * 1_000_000) / 1_000_000;
}

function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return raw.trim();
}

function parseCues(raw: string): VisualStyleCues | null {
  try {
    const parsed = JSON.parse(unwrapJson(raw)) as Record<string, unknown>;
    const colors = Array.isArray(parsed.colors)
      ? parsed.colors.filter((c): c is string => typeof c === 'string')
      : [];
    if (
      colors.length === 0 ||
      typeof parsed.mood !== 'string' ||
      typeof parsed.composition !== 'string' ||
      typeof parsed.subject !== 'string'
    ) {
      return null;
    }
    return {
      colors: colors.slice(0, 6).map((c) => c.toLowerCase()),
      mood: parsed.mood,
      composition: parsed.composition,
      subject: parsed.subject,
    };
  } catch {
    return null;
  }
}

/**
 * Pull structured style cues from an image. Never throws — returns a
 * sentinel result with `fallback: true` on any failure so the caller
 * (the agent tool) can still proceed without a reference.
 */
export async function extractVisualStyleCues(
  args: ExtractCuesArgs,
): Promise<ExtractCuesResult> {
  let client: Anthropic;
  try {
    client = getAnthropicClient(args.apiKey);
  } catch (err) {
    return sentinel(
      err instanceof Error ? err.message : 'Anthropic unavailable',
    );
  }

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: args.mimeType,
                data: args.imageBase64,
              },
            },
            {
              type: 'text',
              text: 'Extract style cues from this image as JSON.',
            },
          ],
        },
      ],
    });
    const costUsd = haikuCost(resp.usage.input_tokens, resp.usage.output_tokens);
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const cues = parseCues(text);
    if (!cues) {
      return {
        ...sentinel('Could not parse Claude response as JSON.'),
        costUsd,
      };
    }
    return { cues, costUsd, model: MODEL, fallback: false };
  } catch (err) {
    return sentinel(
      err instanceof Error ? err.message : 'Vision call failed',
    );
  }
}
