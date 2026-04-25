import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { CampaignAnalyticsClient } from '@/components/campaigns/campaign-analytics-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Campaign analytics' };

/**
 * /t/[slug]/campaigns/[id]/analytics — full analytics surface for a
 * campaign. Server component checks auth + tenant; the client renders
 * the metrics row, funnel viz, time-series, top links, and recipients
 * tab via Recharts + tRPC.
 */
export default async function CampaignAnalyticsPage({
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

  // Confirm the campaign exists in this tenant before rendering.
  const exists = await prisma.campaign.findFirst({
    where: { id: params.id, tenantId: tenant.id },
    select: { id: true },
  });
  if (!exists) notFound();

  return (
    <CampaignAnalyticsClient
      campaignId={params.id}
      tenantSlug={params.slug}
    />
  );
}
