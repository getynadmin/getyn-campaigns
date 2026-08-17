import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { WhatsappAgentWizard } from '@/components/whatsapp-agent/wizard';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'WhatsApp agent' };

export default async function WhatsappAgentDetailPage({
  params,
}: {
  params: { slug: string; id: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();
  return <WhatsappAgentWizard slug={params.slug} agentId={params.id} />;
}
