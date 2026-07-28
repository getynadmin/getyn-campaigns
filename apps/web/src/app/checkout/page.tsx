import type { Metadata } from 'next';

import { CheckoutClient } from '@/components/checkout/checkout-client';
import { DocsFooter } from '@/components/docs/docs-footer';
import { MetaPixel } from '@/components/marketing/meta-pixel';
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

  return (
    <>
      <MetaPixel pixelId={pixels.metaPixelId} />
      <CheckoutClient
        initial={{
          planSlug,
          planName: pricing.planName,
          config: pricing.config,
          volume,
          cycle,
          errorFromReturn: searchParams.error ?? null,
          logoUrl,
        }}
      />
      <DocsFooter logoUrl={footerLogo} />
    </>
  );
}
