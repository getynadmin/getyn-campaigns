import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { NewCampaignChooser } from '@/components/campaigns/new-campaign-chooser';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'New campaign' };

/**
 * Phase 7 M5 — /t/[slug]/campaigns/new is now a chooser between the
 * AI Campaign Agent and the manual flows. The bare email form moved
 * to /campaigns/new/email.
 */
export default async function NewCampaignPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const user = await getCurrentUser();
  if (!user) notFound();
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
  });
  if (!tenant) notFound();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) notFound();
  const canCreate =
    membership.role === Role.OWNER ||
    membership.role === Role.ADMIN ||
    membership.role === Role.EDITOR;
  if (!canCreate) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        New campaign
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How would you like to start?
      </p>
      <div className="mt-6">
        <NewCampaignChooser tenantSlug={params.slug} />
      </div>
    </div>
  );
}
