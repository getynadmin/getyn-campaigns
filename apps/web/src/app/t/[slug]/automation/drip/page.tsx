import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { DripAutomationsListClient } from '@/components/automation/drip-list-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Drip campaigns' };

/**
 * /t/[slug]/automation/drip — Phase 8 M2.
 *
 * List of every Drip automation for this tenant. Click into one for
 * the visual builder. "Create automation" opens a name modal, then
 * routes to the builder with a fresh Trigger → Exit skeleton.
 */
export default async function DripAutomationsListPage({
  params,
}: {
  params: { slug: string };
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
  return <DripAutomationsListClient slug={params.slug} />;
}
