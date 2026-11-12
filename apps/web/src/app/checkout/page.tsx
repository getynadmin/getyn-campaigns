import type { Metadata } from 'next';

import { CheckoutClient } from '@/components/checkout/checkout-client';
import { DocsFooter } from '@/components/docs/docs-footer';
import { TrackingTags } from '@/components/marketing/tracking-tags';
import { getSiteBranding } from '@/server/integrations/site-branding';
import { getTrackingPixels } from '@/server/integrations/tracking-pixels';
import { createCaller } from '@/server/trpc/root';
import { createTRPCContext } from '@/server/trpc/context';

export const metadata: Metadata = {
  title: 'Checkout — Getyn Campaigns',
  description: 'Complete your Getyn Campaigns subscription.',
};

export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: {
    plan?: string;
    volume?: string;
    cycle?: string;
    error?: string;
    extraAi?: string;
    extraWa?: string;
    extraSms?: string;
  };
}): Promise<JSX.Element> {
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const [pricing, branding, pixels] = await Promise.all([
    caller.pricing.publicConfig(),
    getSiteBranding(),
    getTrackingPixels(),
  ]);
  const logoUrl =
    branding.loginPageLogoUrl ?? branding.defaultSidebarLogoLightUrl ?? null;
  const footerLogo =
    branding.defaultSidebarLogoLightUrl ?? branding.loginPageLogoUrl ?? null;

  const planSlug = searchParams.plan ?? pricing.planSlug ?? 'campaigns-pro';
  const volume = Math.max(
    pricing.config.minMessages,
    Number.parseInt(searchParams.volume ?? '', 10) || pricing.config.minMessages,
  );
  const cycle = (searchParams.cycle === 'annual' ? 'annual' : 'monthly') as
    | 'monthly'
    | 'annual';
  const clampBundle = (raw: string | undefined, max: number): number => {
    const n = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, max);
  };
  const extraAi = clampBundle(searchParams.extraAi, 50);
  const extraWa = clampBundle(searchParams.extraWa, 100);
  const extraSms = clampBundle(searchParams.extraSms, 100);

  // AddToCart value — plan monthly price in cents, used for Meta
  // AddToCart + Google Ads add-to-cart conversion on arrival.
  const cfg = pricing.config;
  const extraMsgs = Math.max(0, volume - cfg.baseIncludedMessages);
  const blocks = extraMsgs > 0 ? Math.ceil(extraMsgs / cfg.blockSize) : 0;
  const monthlyCents = cfg.basePriceCents + blocks * cfg.pricePerBlockCents;
  const addToCartCents =
    cycle === 'monthly'
      ? monthlyCents
      : Math.round(
          monthlyCents * 12 * (1 - cfg.annualDiscountPercent / 100),
        );

  return (
    <>
      <TrackingTags
        pixels={pixels}
        addToCart={{
          valueCents: addToCartCents,
          currency: cfg.currency,
        }}
      />
      <CheckoutClient
        initial={{
          planSlug,
          planName: pricing.planName,
          config: pricing.config,
          volume,
          cycle,
          extraAi,
          extraWa,
          extraSms,
          errorFromReturn: searchParams.error ?? null,
          logoUrl,
        }}
      />
      <DocsFooter logoUrl={footerLogo} />
    </>
  );
}
