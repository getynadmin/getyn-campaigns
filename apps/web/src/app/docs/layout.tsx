import type { Metadata } from 'next';

import { DocsFooter } from '@/components/docs/docs-footer';
import { DocsHeader } from '@/components/docs/docs-header';
import { HelpAssistant } from '@/components/help/help-assistant';
import { getSiteBranding } from '@/server/integrations/site-branding';

export const metadata: Metadata = {
  title: { default: 'Getyn Campaigns Docs', template: '%s · Getyn Campaigns Docs' },
  description:
    'Guides and reference for Getyn Campaigns — email, WhatsApp, and SMS marketing with an AI copilot.',
};

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const branding = await getSiteBranding();
  const logoUrl = branding.defaultSidebarLogoLightUrl;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <DocsHeader logoUrl={logoUrl} />
      <main className="flex-1">{children}</main>
      <DocsFooter logoUrl={logoUrl} />
      <HelpAssistant />
    </div>
  );
}
