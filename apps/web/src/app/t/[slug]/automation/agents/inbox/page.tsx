import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { ApprovalInboxClient } from '@/components/email-agent/approval-inbox-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Email agent approvals' };

/**
 * /t/[slug]/automation/agents/inbox — Phase 8 M5.
 *
 * Human-approval queue for the Email Agent's reply drafts. Every
 * reply-drafting cycle lands one row here for the operator to
 * approve, edit, reject, or exit.
 */
export default async function EmailAgentInboxPage({
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
  return <ApprovalInboxClient />;
}
