import { prisma } from '@getyn/db';

import {
  DEFAULT_DYNAMIC_PRICING,
  readPricingConfig,
} from '@/server/billing/dynamic-pricing';

import { createTRPCRouter, publicProcedure } from '../trpc';

/**
 * Phase 9 — public pricing surface.
 *
 * The /pricing marketing page reads `publicConfig` (unauthenticated)
 * to render the slider + live price. Config is read from the
 * default non-archived plan whose metadata carries a `pricing` block.
 * Falls back to DEFAULT_DYNAMIC_PRICING when nothing is seeded, so
 * the page always renders — never a 500 that scares off shoppers.
 */
export const pricingRouter = createTRPCRouter({
  publicConfig: publicProcedure.query(async () => {
    // Fail-open on DB errors — the /pricing page is a marketing
    // surface, better to show default prices than a 500 that scares
    // off shoppers.
    let plans: Array<{
      id: string;
      slug: string;
      name: string;
      description: string | null;
      metadata: unknown;
      features: Array<{ metric: string; included: number }>;
    }> = [];
    try {
      plans = await prisma.plan.findMany({
        where: { isArchived: false },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          metadata: true,
          features: { select: { metric: true, included: true } },
        },
        orderBy: [{ isDefault: 'desc' }, { priceMonthlyCents: 'asc' }],
      });
    } catch (err) {
      console.warn('[pricing.publicConfig] DB unreachable, using defaults', err);
    }

    for (const p of plans) {
      const cfg = readPricingConfig(p.metadata);
      if (cfg) {
        return {
          planId: p.id,
          planSlug: p.slug,
          planName: p.name,
          description: p.description,
          features: p.features,
          config: cfg,
        };
      }
    }

    return {
      planId: null as string | null,
      planSlug: null as string | null,
      planName: 'Campaigns Pro',
      description:
        'Everything you need to run email, WhatsApp, and drip campaigns.',
      features: [] as Array<{ metric: string; included: number }>,
      config: DEFAULT_DYNAMIC_PRICING,
    };
  }),
});
