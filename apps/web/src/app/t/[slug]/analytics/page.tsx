import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@getyn/db';

import { AnalyticsClient } from '@/components/analytics/analytics-client';
import { getCurrentUser } from '@/server/auth/session';

export const metadata = { title: 'Analytics' };

/**
 * /t/[slug]/analytics — tabbed roll-ups of every reportable surface:
 * overview, email campaigns, WhatsApp campaigns, drip flows, agents,
 * audience, deliverability. All reads live in `analyticsRouter`.
 */
export default async function AnalyticsPage({
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          <Link
            href={`/t/${params.slug}/dashboard`}
            className="underline-offset-4 hover:underline"
          >
            Dashboard
          </Link>{' '}
          / Analytics
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reporting across every channel, automation and agent. Pick a tab
          and a date range.
        </p>
      </div>
      <AnalyticsClient />
    </div>
  );
}
