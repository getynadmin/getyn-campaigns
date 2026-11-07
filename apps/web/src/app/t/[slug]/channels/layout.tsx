import Link from 'next/link';
import type { ReactNode } from 'react';

import { ChannelsTabsNav } from '@/components/channels/channels-tabs-nav';

export const metadata = { title: 'Channels' };

/**
 * Workspace → Channels shell. Mirrors the Settings layout so the
 * channel pages have breadcrumb, title and a tab strip of their own;
 * each channel page lives at /channels/<key>.
 */
export default function ChannelsLayout({
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
          / Channels
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          Channels
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connected sending channels. Each channel is bring-your-own —
          credentials live in your accounts and we store the working tokens
          encrypted.
        </p>
      </div>
      <ChannelsTabsNav tenantSlug={params.slug} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
