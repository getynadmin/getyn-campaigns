import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { AutonomousCampaignsClient } from '@/components/automation/autonomous-campaigns-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Autonomous Campaigns' };

/**
 * /t/[slug]/automation/autonomous — single home for both Email and
 * WhatsApp agents. The existing per-channel list clients are rendered
 * under top tabs; old /automation/agents and /automation/whatsapp-agents
 * routes redirect here with the right tab active.
 */
export default async function AutonomousCampaignsPage({
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

  const tab = searchParams?.tab === 'whatsapp' ? 'whatsapp' : 'email';

  return <AutonomousCampaignsClient slug={params.slug} initialTab={tab} />;
}
