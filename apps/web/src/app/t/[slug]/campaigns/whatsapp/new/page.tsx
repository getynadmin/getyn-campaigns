import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { WhatsAppCampaignNewClient } from '@/components/whatsapp-campaigns/whatsapp-campaign-new-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'New WhatsApp campaign' };

/**
 * Settings → Campaigns → New WhatsApp campaign.
 *
 * Server component resolves user + tenant + role. Walks the tenant
 * through a 3-step form: identity (name + segment) → template
 * (template + phone + variables) → review + send. The send call
 * fires sendNow / schedule on whatsAppCampaign tRPC and routes back
 * to the campaign list.
 */
export default async function NewWhatsAppCampaignPage({
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
  if (membership.role === Role.VIEWER) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          New WhatsApp campaign
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Send an approved template to a contact segment. Variables
          resolve per-recipient at send time. We&apos;ll exclude any
          contacts on your WhatsApp suppression list.
        </p>
      </div>

      <WhatsAppCampaignNewClient tenantSlug={params.slug} />
    </div>
  );
}
