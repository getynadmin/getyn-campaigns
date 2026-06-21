import type { Metadata } from 'next';

import { DocsFooter } from '@/components/docs/docs-footer';
import { DocsHeader } from '@/components/docs/docs-header';

export const metadata: Metadata = {
  title: { default: 'Getyn Campaigns Docs', template: '%s · Getyn Campaigns Docs' },
  description:
    'Guides and reference for Getyn Campaigns — email, WhatsApp, and SMS marketing with an AI copilot.',
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <DocsHeader />
      <main className="flex-1">{children}</main>
      <DocsFooter />
    </div>
  );
}
