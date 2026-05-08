/**
 * @getyn/ai — Anthropic Claude API wrapper for Getyn Campaigns.
 *
 * Phase 4 M7 introduces the first AI feature (WhatsApp template
 * drafting). Phase 5 expands this package with email subject lines,
 * inbox reply suggestions, and segment naming.
 *
 * Design choices:
 *   - All callers go through one client so we can add tracing /
 *     budgeting / safety filters in one place later.
 *   - Structured output is enforced via JSON-schema-shaped prompts
 *     and Zod validation post-parse. No native function-calling
 *     primitives — keeps the surface model-agnostic for Phase 5
 *     where we may want OSS fallbacks.
 *   - Token + cost tracking is computed here and returned in the
 *     result so callers can persist to AiGeneration without round-
 *     tripping the response.
 *
 * The Anthropic SDK is the only runtime dep; everything else is
 * thin wrappers + Zod.
 */

export * from './client';
export * from './template-draft';
