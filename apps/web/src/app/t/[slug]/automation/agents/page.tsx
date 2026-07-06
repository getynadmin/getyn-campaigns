import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { EmailAgentsListClient } from '@/components/email-agent/agents-list-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Email agents' };

export default async function EmailAgentsListPage({
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
  return <EmailAgentsListClient slug={params.slug} />;
}
