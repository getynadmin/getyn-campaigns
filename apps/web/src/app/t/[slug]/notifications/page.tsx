import Link from 'next/link';

import { NotificationsListClient } from '@/components/app-shell/notifications-list-client';

export const metadata = { title: 'Notifications' };

export default function NotificationsPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">
          <Link
            href={`/t/${params.slug}/dashboard`}
            className="underline-offset-4 hover:underline"
          >
            Dashboard
          </Link>{' '}
          / Notifications
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything that happened in this workspace. Click a row to open it or
          mark it read.
        </p>
      </div>
      <NotificationsListClient />
    </div>
  );
}
