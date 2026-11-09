import { notFound } from 'next/navigation';
import { Mail, MessageSquare, Phone } from 'lucide-react';

import { Role, prisma } from '@getyn/db';

import { CampaignsListClient } from '@/components/campaigns/campaigns-list-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Campaigns' };

/**
 * /t/[slug]/campaigns — campaign list view.
 *
 * Server component resolves user/tenant/membership and hands canCreate /
 * canDelete flags to the client. The list query + filtering live client
 * side so search-as-you-type stays snappy.
 */
export default async function CampaignsPage({
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <section className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-sky-50 to-amber-50 p-6 shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/40 dark:via-sky-950/30 dark:to-amber-950/30">
        <div className="pointer-events-none absolute -right-20 -top-20 size-60 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-500/10" />
        <div className="pointer-events-none absolute -bottom-24 right-32 size-56 rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-500/10" />
        <div className="relative flex flex-col gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            Campaigns
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Launch tracked <strong>email</strong>, <strong>WhatsApp</strong>{' '}
            and <strong>SMS</strong> campaigns to a contact segment — one
            builder, one list, one set of analytics.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white/70 px-2.5 py-1 font-medium text-sky-900 backdrop-blur dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
              <Mail className="size-3.5" />
              Email
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/70 px-2.5 py-1 font-medium text-emerald-900 backdrop-blur dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
              <MessageSquare className="size-3.5" />
              WhatsApp
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white/70 px-2.5 py-1 font-medium text-amber-900 backdrop-blur dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              <Phone className="size-3.5" />
              SMS
            </span>
          </div>
        </div>
      </section>
      <CampaignsListClient tenantSlug={params.slug} canCreate={canCreate} />
    </div>
  );
}
