import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { CampaignDetailClient } from '@/components/campaigns/campaign-detail-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Campaign' };

/**
 * /t/[slug]/campaigns/[id] — campaign detail / wizard.
 *
 * For DRAFT campaigns this renders the four-step wizard inline as
 * collapsible cards (Recipients, Design, Settings, Review). For
 * SCHEDULED / SENDING / SENT it renders a summary view with a link
 * to the analytics page (M8).
 *
 * Server component resolves user/tenant/membership; the client does
 * the rest via tRPC.
 */
export default async function CampaignPage({
  params,
}: {
  params: { slug: string; id: string };
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

  const canEdit =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;
  const canSend =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <CampaignDetailClient
      campaignId={params.id}
      tenantSlug={params.slug}
      canEdit={canEdit}
      canSend={canSend}
      tenantPostalAddressMissing={!tenant.postalAddress}
    />
  );
}
