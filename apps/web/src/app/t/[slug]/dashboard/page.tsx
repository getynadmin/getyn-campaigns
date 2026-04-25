import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

import { prisma, withTenant } from '@getyn/db';

import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TRIAL_DAYS } from '@/lib/constants';

export const metadata = { title: 'Dashboard' };

/**
 * Tenant dashboard.
 *
 * Three panels:
 *   1. Greeting + trial countdown.
 *   2. Onboarding checklist — 4 steps reflecting Phase 2 deliverables.
 *   3. Stat strip — live counts for the audience surfaces shipped in Phase 2.
 *
 * The campaign / send-pipeline numbers (sent, open rate) intentionally still
 * read "Coming in Phase 3" — Phase 2 is exclusively about the audience side
 * of the product, and we don't want to look like we're shipping data we
 * haven't built yet.
 */
export default async function DashboardPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
    include: { _count: { select: { memberships: true } } },
  });
  if (!tenant) notFound();

  const trialDaysLeft = tenant.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  // All Phase 2 counts in one tenant-scoped transaction. The supporting
  // indexes (tenantId, deletedAt) on Contact and (tenantId, createdAt) on
  // Segment / SuppressionEntry keep these as cheap covered counts.
  const { contactsCount, segmentsCount, suppressedCount } = await withTenant(
    tenant.id,
    async (tx) => {
      const [contactsCount, segmentsCount, suppressedCount] = await Promise.all(
        [
          tx.contact.count({ where: { tenantId: tenant.id, deletedAt: null } }),
          tx.segment.count({ where: { tenantId: tenant.id } }),
          tx.suppressionEntry.count({ where: { tenantId: tenant.id } }),
        ],
      );
      return { contactsCount, segmentsCount, suppressedCount };
    },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Workspace</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {tenant.name}
          </h1>
        </div>
        {trialDaysLeft !== null ? (
          <div className="rounded-lg border bg-card px-4 py-2 text-sm">
            <span className="font-medium">{trialDaysLeft}</span>{' '}
            <span className="text-muted-foreground">
              of {TRIAL_DAYS} trial days left
            </span>
          </div>
        ) : null}
      </div>

      <OnboardingChecklist
        tenantSlug={params.slug}
        teamSize={tenant._count.memberships}
        contactsCount={contactsCount}
        segmentsCount={segmentsCount}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Contacts"
          value={contactsCount.toLocaleString()}
          href={`/t/${params.slug}/contacts`}
          cta="Manage contacts"
        />
        <StatCard
          label="Segments"
          value={segmentsCount.toLocaleString()}
          href={`/t/${params.slug}/segments`}
          cta="View segments"
        />
        <StatCard
          label="Suppressed"
          value={suppressedCount.toLocaleString()}
          href={`/t/${params.slug}/suppression`}
          cta="View list"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PlaceholderStatCard
          label="Campaigns sent"
          hint="Coming in Phase 3"
        />
        <PlaceholderStatCard label="Open rate" hint="Coming in Phase 3" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  cta,
}: {
  label: string;
  value: string;
  href: string;
  cta: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold">{value}</p>
        <Link
          href={href}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {cta}
          <ArrowRight className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

function PlaceholderStatCard({
  label,
  hint,
}: {
  label: string;
  hint: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold text-muted-foreground/60">
          —
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
