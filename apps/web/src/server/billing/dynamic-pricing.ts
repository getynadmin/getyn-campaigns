import { z } from 'zod';

/**
 * Phase 9 — dynamic-pricing config for the single-tier Campaigns plan.
 *
 * Stored on Plan.metadata.pricing. Read by:
 *   - admin plan editor (form initial values + validation)
 *   - public /pricing page (slider + live price)
 *   - tRPC pricing.calculate (single source of truth for the number
 *     shown to the user)
 *
 * All monetary values are US cents to avoid float drift.
 */
export const dynamicPricingSchema = z.object({
  model: z.literal('dynamic'),
  basePriceCents: z.number().int().min(0),
  baseIncludedMessages: z.number().int().min(1),
  blockSize: z.number().int().min(1),
  pricePerBlockCents: z.number().int().min(0),
  annualDiscountPercent: z.number().int().min(0).max(90).default(25),
  minMessages: z.number().int().min(1),
  maxMessages: z.number().int().min(1),
  currency: z.string().length(3).default('USD'),
});

export type DynamicPricingConfig = z.infer<typeof dynamicPricingSchema>;

/**
 * Extract the dynamic-pricing config from a Plan.metadata blob.
 * Returns null when the plan uses the legacy fixed-tier model — that
 * signals callers to fall back to Plan.priceMonthlyCents/Yearly.
 */
export function readPricingConfig(
  metadata: unknown,
): DynamicPricingConfig | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const pricing = (metadata as { pricing?: unknown }).pricing;
  if (!pricing) return null;
  const parsed = dynamicPricingSchema.safeParse(pricing);
  return parsed.success ? parsed.data : null;
}

/** Round the requested volume to the nearest block boundary, clamped to config. */
export function normalizeVolume(
  requested: number,
  cfg: DynamicPricingConfig,
): number {
  const clamped = Math.min(
    Math.max(requested, cfg.minMessages),
    cfg.maxMessages,
  );
  // Snap to blockSize starting from baseIncludedMessages.
  if (clamped <= cfg.baseIncludedMessages) return cfg.baseIncludedMessages;
  const extra = clamped - cfg.baseIncludedMessages;
  const blocks = Math.ceil(extra / cfg.blockSize);
  return cfg.baseIncludedMessages + blocks * cfg.blockSize;
}

export interface PriceQuote {
  volume: number;
  monthlyCents: number;
  yearlyCents: number;
  yearlyMonthlyEffectiveCents: number;
  annualDiscountPercent: number;
  currency: string;
}

/**
 * Compute monthly + annual prices for a requested volume. Yearly
 * price = monthly × 12 × (1 - discount%), then rounded to whole cents.
 */
export function calculatePrice(
  requestedVolume: number,
  cfg: DynamicPricingConfig,
): PriceQuote {
  const volume = normalizeVolume(requestedVolume, cfg);
  const extra = Math.max(0, volume - cfg.baseIncludedMessages);
  const blocks = extra > 0 ? Math.ceil(extra / cfg.blockSize) : 0;
  const monthlyCents = cfg.basePriceCents + blocks * cfg.pricePerBlockCents;
  const yearlyCents = Math.round(
    monthlyCents * 12 * (1 - cfg.annualDiscountPercent / 100),
  );
  const yearlyMonthlyEffectiveCents = Math.round(yearlyCents / 12);
  return {
    volume,
    monthlyCents,
    yearlyCents,
    yearlyMonthlyEffectiveCents,
    annualDiscountPercent: cfg.annualDiscountPercent,
    currency: cfg.currency,
  };
}

/** Default config seeded into a new dynamic plan — matches Phase 9 spec. */
export const DEFAULT_DYNAMIC_PRICING: DynamicPricingConfig = {
  model: 'dynamic',
  basePriceCents: 1900, // $19
  baseIncludedMessages: 5000,
  blockSize: 5000,
  pricePerBlockCents: 1000, // $10 per extra 5k
  annualDiscountPercent: 25,
  minMessages: 5000,
  maxMessages: 500000,
  currency: 'USD',
};
