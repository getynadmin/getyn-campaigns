import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { WhatsAppTemplatesClient } from '@/components/whatsapp-templates/whatsapp-templates-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'WhatsApp templates' };

/**
 * Settings → Channels → WhatsApp → Templates list.
 *
 * Browse open to every member; create/edit/submit/delete go through
 * tRPC role gates (OWNER/ADMIN; EDITOR can author + submit but cannot
 * delete). We pass the tenant's WABA-connected status to the client so
 * the empty state can route the user to the connect page if needed.
 */
export default async function WhatsAppTemplatesPage({
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

  const account = await prisma.whatsAppAccount.findUnique({
    where: { tenantId: tenant.id },
    select: { id: true, status: true },
  });

  const canManage =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;
  const canAuthor = canManage || membership.role === Role.EDITOR;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          WhatsApp templates
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Author, submit and manage the message templates Meta has on file
          for this WABA. Approved templates are sendable through campaigns;
          the inbox can use any of them outside the 24h customer service
          window.
        </p>
      </div>

      <WhatsAppTemplatesClient
        tenantSlug={params.slug}
        canManage={canManage}
        canAuthor={canAuthor}
        accountConnected={Boolean(account && account.status === 'CONNECTED')}
      />
    </div>
  );
}
