import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { SendingDomainsClient } from '@/components/sending-domains/sending-domains-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Email channel' };

/**
 * Channels → Email. Reuses the existing SendingDomainsClient which
 * owns the full add-a-domain / verify-records flow inline, so the
 * old settings → sending-domains screen is preserved verbatim here
 * — no duplicate UI.
 */
export default async function EmailChannelPage({
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

  const canManage =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Email
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify a domain you own to send campaigns from your own address.
          Without one, campaigns send from our shared{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            @getynmail.com
          </code>{' '}
          pool — fine for getting started, but inboxing is meaningfully
          better with a verified domain.
        </p>
      </div>

      <SendingDomainsClient canManage={canManage} />
    </div>
  );
}
