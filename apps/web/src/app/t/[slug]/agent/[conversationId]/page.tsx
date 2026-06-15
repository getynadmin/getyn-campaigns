import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { AgentChatClient } from '@/components/agent/agent-chat-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Campaign agent' };

/**
 * Phase 7 M5 — agent chat page.
 *
 * Thin server shell: confirms the conversation exists in this tenant
 * and the user is a member, then hands off to the chat client which
 * manages the SSE stream + tRPC queries.
 *
 * The conversation may be in ACTIVE / COMPLETED_DRAFT_CREATED /
 * ABANDONED / FAILED status; the client renders accordingly (input
 * disabled when not ACTIVE, "Open in editor" banner when finalized).
 */
export default async function AgentConversationPage({
  params,
}: {
  params: { slug: string; conversationId: string };
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
    select: { id: true },
  });
  if (!membership) notFound();

  const convo = await prisma.agentConversation.findFirst({
    where: { id: params.conversationId, tenantId: tenant.id },
    select: { id: true },
  });
  if (!convo) notFound();

  return (
    <AgentChatClient
      conversationId={params.conversationId}
      tenantSlug={params.slug}
    />
  );
}
