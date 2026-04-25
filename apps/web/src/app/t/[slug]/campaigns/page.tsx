import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { CampaignsListClient } from '@/components/campaigns/campaigns-list-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Campaigns' };

/**
 * /t/[slug]/campaigns — campaign list view.
 *
 * Server component resolves user/tenant/membership and hands canCreate /
 * canDelete flags to the client. The list query + filtering live client
 * side so search-as-you-type stays snappy.
 */
export default async function CampaignsPage({
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

  const canCreate =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a tracked email campaign to a segment. Drafts auto-save —
            edits land the moment you tab away.
          </p>
        </div>
      </div>
      <CampaignsListClient tenantSlug={params.slug} canCreate={canCreate} />
    </div>
  );
}
