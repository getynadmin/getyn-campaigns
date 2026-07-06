import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { AutomationBuilderClient } from '@/components/automation/automation-builder-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Edit automation' };

/**
 * /t/[slug]/automation/drip/[id]/edit — Phase 8 M2 visual builder.
 *
 * Server component: resolves auth + tenant + membership; the builder
 * itself is a client component (React Flow canvas + tRPC autosave).
 */
export default async function AutomationEditPage({
  params,
}: {
  params: { slug: string; id: string };
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
  return <AutomationBuilderClient automationId={params.id} slug={params.slug} />;
}
