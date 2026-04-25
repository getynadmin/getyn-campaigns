import Link from 'next/link';
import type { ReactNode } from 'react';

import { SettingsTabsNav } from '@/components/settings/settings-tabs-nav';

export const metadata = { title: 'Settings' };

/**
 * Shell for every settings page. The tab strip is a client component
 * (needs `usePathname`) but everything else stays on the server.
 */
export default function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { slug: string };
}): JSX.Element {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">
          <Link
            href={`/t/${params.slug}/dashboard`}
            className="underline-offset-4 hover:underline"
          >
            Dashboard
          </Link>{' '}
          / Settings
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          Settings
        </h1>
      </div>
      <SettingsTabsNav tenantSlug={params.slug} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
