import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { InboxClient } from '@/components/inbox/inbox-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Inbox' };

/**
 * /t/[slug]/inbox — Phase 4 M10.
 *
 * Three-pane WhatsApp inbox: conversation list (left), thread
 * (center), contact details (right). Server component resolves user
 * + tenant + role; client component handles the live UI, paging
 * and Realtime subscription.
 */
export default async function InboxPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
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

  return (
    <InboxClient
      tenantSlug={params.slug}
      currentUser={{
        id: user.id,
        name: user.name ?? user.email ?? 'You',
      }}
      canCloseReopen={canCloseReopen}
    />
  );
}
