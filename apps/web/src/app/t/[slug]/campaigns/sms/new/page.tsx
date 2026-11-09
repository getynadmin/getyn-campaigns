import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { SmsCampaignNewClient } from '@/components/sms-campaigns/sms-campaign-new-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'New SMS campaign' };

export default async function NewSmsCampaignPage({
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
  if (!membership || membership.role === Role.VIEWER) notFound();

  return <SmsCampaignNewClient tenantSlug={params.slug} />;
}
