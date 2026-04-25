import { notFound } from 'next/navigation';

import { Plan, Role, prisma } from '@getyn/db';

import { SendingDomainsClient } from '@/components/sending-domains/sending-domains-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Sending domains' };

/**
 * Tenant settings → Sending domains.
 *
 * Browse is open to all members; create/verify/delete are gated to
 * OWNER/ADMIN at the tRPC layer. STARTER + TRIAL plans see an upgrade
 * banner instead of the "Add domain" button — explicit gating, not just
 * hidden UI.
 *
 * The page is a server component so we can resolve the user/tenant once
 * and hand a tight props payload to the client component. The list +
 * mutations happen via tRPC from there.
 */
export default async function SendingDomainsPage({
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
  const planAllowsDomains =
    tenant.plan === Plan.GROWTH || tenant.plan === Plan.PRO;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Sending domains
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Verify a domain you own to send campaigns from your own address.
          Without one, campaigns send from our shared{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            @send.getyn.app
          </code>{' '}
          pool — fine for getting started, but inboxing is meaningfully
          better with a verified domain.
        </p>
      </div>

      <SendingDomainsClient
        canManage={canManage}
        planAllowsDomains={planAllowsDomains}
        plan={tenant.plan}
      />
    </div>
  );
}
