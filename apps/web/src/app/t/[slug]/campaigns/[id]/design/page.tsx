import { notFound } from 'next/navigation';

import { CampaignStatus, Role, prisma } from '@getyn/db';

import { CampaignDesignClient } from '@/components/campaigns/campaign-design-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Design campaign' };

/**
 * /t/[slug]/campaigns/[id]/design — full-screen Unlayer editor for an
 * EmailCampaign. Same EmailBuilder component used by the templates
 * design page; only the save target differs.
 *
 * Editing is gated to DRAFT campaigns only — the renderedHtml is locked
 * by the DB trigger once status moves out of DRAFT, and the tRPC
 * `saveDesign` mutation also enforces it.
 */
export default async function CampaignDesignPage({
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

  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, tenantId: tenant.id },
    include: { emailCampaign: true },
  });
  if (!campaign || !campaign.emailCampaign) notFound();

  const isDraft = campaign.status === CampaignStatus.DRAFT;
  const canEdit =
    isDraft &&
    (membership.role === Role.OWNER ||
      membership.role === Role.ADMIN ||
      membership.role === Role.EDITOR);

  return (
    <CampaignDesignClient
      campaign={{
        id: campaign.id,
        name: campaign.name,
        designJson: campaign.emailCampaign.designJson as Record<string, unknown>,
        isDraft,
      }}
      tenantSlug={params.slug}
      canEdit={canEdit}
    />
  );
}
