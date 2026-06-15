import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { AgentListClient } from '@/components/agent/agent-list-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Agent conversations' };

/**
 * Phase 7 M5 — agent conversation list / resume page.
 *
 * Lists recent AgentConversation rows for the tenant so the user can
 * resume an ACTIVE one, see what's finalized, or pick up where they
 * left off. New conversations start from /campaigns/new (the chooser).
 */
export default async function AgentListPage({
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
    select: { id: true },
  });
  if (!membership) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Agent conversations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick up where you left off, or start a new conversation from{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            Campaigns → New
          </code>
          .
        </p>
      </div>
      <AgentListClient tenantSlug={params.slug} />
    </div>
  );
}
