import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { EmailAgentKanban } from '@/components/email-agent/kanban/kanban';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Agent board' };

export default async function EmailAgentBoardPage({
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
  const agent = await prisma.emailAgent.findFirst({
    where: { id: params.id, tenantId: tenant.id },
    select: { id: true, name: true },
  });
  if (!agent) notFound();
  return (
    <EmailAgentKanban agentId={agent.id} agentName={agent.name} slug={params.slug} />
  );
}
