import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { CampaignNewClient } from '@/components/campaigns/campaign-new-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'New campaign' };

/**
 * /t/[slug]/campaigns/new — minimal create form. Once submitted we POST
 * `campaign.create` with stub settings, redirect to /campaigns/[id], and
 * the user finishes the rest of the wizard there with auto-saved drafts.
 *
 * The rationale for pre-creating the row: each subsequent step (design,
 * settings, recipients, review) writes back to the persisted DRAFT, so
 * page reloads or browser crashes don't lose progress.
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
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        New campaign
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a name and a segment to start. You'll fill in the design and
        send settings on the next page.
      </p>
      <div className="mt-6">
        <CampaignNewClient
          tenantSlug={params.slug}
          tenantDefaults={{
            fromName:
              tenant.defaultFromName ??
              tenant.companyDisplayName ??
              tenant.name,
            // No default for fromEmail — the tenant explicitly picks per-campaign.
            fromEmail: '',
          }}
        />
      </div>
    </div>
  );
}
