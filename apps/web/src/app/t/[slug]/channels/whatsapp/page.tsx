import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, MessageSquare } from 'lucide-react';

import { Role, prisma } from '@getyn/db';

import { WhatsAppChannelsClient } from '@/components/whatsapp-channels/whatsapp-channels-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'WhatsApp channel' };

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
        <h2 className="font-display text-xl font-semibold tracking-tight">
          WhatsApp Business
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your WhatsApp Business Account to send template campaigns
          and reply to inbound messages from the inbox. Bring your own WABA
          from{' '}
          <a
            href="https://business.facebook.com/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Meta Business Manager
          </a>
          .
        </p>
      </div>

      <WhatsAppChannelsClient canManage={canManage} />

      <Link
        href={`/t/${params.slug}/settings/channels/whatsapp/templates`}
        className="group flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
            <MessageSquare className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Templates</p>
            <p className="text-xs text-muted-foreground">
              Author, submit, sync and version templates for this WABA.
            </p>
          </div>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
