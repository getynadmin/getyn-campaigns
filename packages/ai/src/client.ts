/**
 * Anthropic client + cost calculation. Singleton-per-process so the
 * SDK's connection pooling actually pools.
 */
import Anthropic from '@anthropic-ai/sdk';

let cached: Anthropic | null = null;

export class AiNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY unset — AI features are disabled.');
    this.name = 'AiNotConfiguredError';
  }
}

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfiguredError();
  cached = new Anthropic({ apiKey: key });
  return cached;
}

/**
 * Active model — we pin a specific Claude version so prompt behaviour
 * doesn't shift under us between deploys. Bump explicitly when we
 * validate a new model against the prompt suites.
 */
export const ACTIVE_MODEL = 'claude-3-5-sonnet-20241022' as const;

/**
 * Per-million-token rates for the active model (USD). Update alongside
 * ACTIVE_MODEL — Anthropic publishes these per model on their pricing
 * page. Used for AiGeneration.cost and per-tenant rollups.
 */
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export function computeCost(
  inputTokens: number,
  outputTokens: number,
): CostBreakdown {
  const costUsd =
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    // Round to 6 decimals so we never store noise from floating-point.
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
