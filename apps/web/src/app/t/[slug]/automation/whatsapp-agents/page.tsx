import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { WhatsappAgentsListClient } from '@/components/whatsapp-agent/agents-list-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'WhatsApp agents' };

export default async function WhatsappAgentsListPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();
  return <WhatsappAgentsListClient slug={params.slug} />;
}
