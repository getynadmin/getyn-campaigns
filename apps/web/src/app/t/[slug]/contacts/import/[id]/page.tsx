import { notFound } from 'next/navigation';
import { prisma } from '@getyn/db';

import { ImportProgress } from '@/components/contacts/import-progress';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Import progress' };

/**
 * Progress page for a single import. Component polls `imports.get` every
 * 2s while the job is active and stops once it reaches a terminal state.
 */
export default async function ImportProgressPage({
  params,
}: {
  params: { slug: string; id: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { slug: params.slug } });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();

  return <ImportProgress tenantSlug={params.slug} importJobId={params.id} />;
}
