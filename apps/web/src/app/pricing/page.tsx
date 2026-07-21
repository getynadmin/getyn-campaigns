import type { Metadata } from 'next';

import { DocsFooter } from '@/components/docs/docs-footer';
import { DocsHeader } from '@/components/docs/docs-header';
import { PricingClient } from '@/components/pricing/pricing-client';
import { getSiteBranding } from '@/server/integrations/site-branding';
import { createCaller } from '@/server/trpc/root';
import { createTRPCContext } from '@/server/trpc/context';

export const metadata: Metadata = {
  title: 'Pricing — Getyn Campaigns',
  description:
    'One plan, all features. Slide to pick your monthly message volume — email, WhatsApp, and drip campaigns included.',
};

export const dynamic = 'force-dynamic';

export default async function PricingPage(): Promise<JSX.Element> {
  // Server-fetch the config so the page hydrates with real prices on
  // first paint (no loading flicker on the anchor slider).
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const [initial, branding] = await Promise.all([
    caller.pricing.publicConfig(),
    getSiteBranding(),
  ]);
  const logoUrl =
    branding.defaultSidebarLogoLightUrl ?? branding.loginPageLogoUrl ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <DocsHeader logoUrl={logoUrl} />
      <main className="flex-1">
        <PricingClient initial={initial} />
      </main>
      <DocsFooter />
    </div>
  );
}
