import { notFound } from 'next/navigation';

import { Role, prisma } from '@getyn/db';

import { WhatsAppChannelsClient } from '@/components/whatsapp-channels/whatsapp-channels-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'WhatsApp Business' };

/**
 * Settings → Channels → WhatsApp.
 *
 * Server component resolves user + membership once, hands a small
 * props payload to the client. Connect / disconnect / refresh land via
 * tRPC. Read access is open to every member; mutation buttons are
 * hidden for EDITOR / VIEWER and the server router rejects them too.
 *
 * Plan gating is deferred to M11 (we'll mirror SendingDomain's pattern
 * once billing surfaces are wired). For now any tenant can connect.
 */
export default async function WhatsAppChannelPage({
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

  const canManage =
    membership.role === Role.OWNER || membership.role === Role.ADMIN;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          WhatsApp Business
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your WhatsApp Business Account to send template campaigns
          and reply to inbound messages from the inbox. You bring your own
          WABA from{' '}
          <a
            href="https://business.facebook.com/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Meta Business Manager
          </a>
          ; we never own credentials on your behalf.
        </p>
      </div>

      <WhatsAppChannelsClient canManage={canManage} />
    </div>
  );
}
