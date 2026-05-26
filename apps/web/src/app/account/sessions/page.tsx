import { redirect } from 'next/navigation';

import { SessionsClient } from '@/components/account/sessions-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Active sessions' };

/**
 * Phase 5 M2 — user-scoped session listing.
 *
 * Lives outside /t/[slug] because sessions belong to the user, not a
 * tenant. Same user signed into multiple tenants sees one consolidated
 * list. Provides device label, IP, last-seen timestamp, and a Revoke
 * action per row.
 */
export default async function SessionsPage(): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) redirect('/login?return_to=/account/sessions');

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Active sessions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Devices currently signed into your Getyn account. Revoke any
          device you don&apos;t recognize.
        </p>
      </header>
      <SessionsClient />
    </div>
  );
}
