import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { UnifiedInboxClient } from '@/components/inbox/unified-inbox-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Unified Inbox' };

/**
 * /t/[slug]/unified-inbox — merges WhatsApp Inbox + Email Inbox into
 * a single sidebar entry with a tab switcher. The original three-pane
 * WhatsApp inbox and the email diagnostic list are both preserved
 * verbatim, just hosted under tabs.
 *
 * The old /inbox and /email-inbox routes still work — they redirect
 * here with the right tab pre-selected.
 */
export default async function UnifiedInboxPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { tab?: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
    select: { id: true },
  });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  const canCloseReopen =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;

  const tab = searchParams?.tab === 'email' ? 'email' : 'whatsapp';

  return (
    <UnifiedInboxClient
      tenantSlug={params.slug}
      initialTab={tab}
      currentUser={{
        id: user.id,
        name: user.name ?? user.email ?? 'You',
      }}
      canCloseReopen={canCloseReopen}
    />
  );
}
