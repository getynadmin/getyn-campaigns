import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';

import { prisma, withTenant } from '@getyn/db';

import { DashboardGrid } from '@/components/dashboard/dashboard-grid';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { TRIAL_DAYS } from '@/lib/constants';

export const metadata = { title: 'Dashboard' };

/**
 * Tenant dashboard — a bar of workspace context + the (collapsible,
 * dismissible) onboarding checklist + the customisable widget grid.
 * The old static panels are replaced by `DashboardGrid` so widgets
 * can be reordered/hidden per-user-per-tenant and the whole page
 * stays useful the day a user signs in even before they have data.
 */
export default async function DashboardPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: params.slug },
  });
  if (!tenant) notFound();

  // Brand nudge — wrapped in try/catch so a missing table on legacy
  // deploys doesn't 500 the dashboard.
  let brandProfile: { completedAt: Date | null } | null = null;
  try {
    brandProfile = await prisma.tenantBrandProfile.findUnique({
      where: { tenantId: tenant.id },
      select: { completedAt: true },
    });
  } catch {
    brandProfile = null;
  }

  const trialDaysLeft = tenant.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  // Just the counts the onboarding checklist needs; everything else
  // loads per-widget on the client.
  const { contactsCount, segmentsCount, campaignsCount, verifiedDomains, waAccount } =
    await withTenant(tenant.id, async (tx) => {
      const [contactsCount, segmentsCount, campaignsCount, verifiedDomains, waAccount] =
        await Promise.all([
          tx.contact.count({ where: { tenantId: tenant.id, deletedAt: null } }),
          tx.segment.count({ where: { tenantId: tenant.id } }),
          tx.campaign.count({ where: { tenantId: tenant.id } }),
          tx.sendingDomain.count({
            where: { tenantId: tenant.id, status: 'VERIFIED' },
          }),
          tx.whatsAppAccount.findFirst({
            where: { tenantId: tenant.id, status: 'CONNECTED' },
            select: { id: true },
          }),
        ]);
      return {
        contactsCount,
        segmentsCount,
        campaignsCount,
        verifiedDomains,
        waAccount,
      };
    });

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
      {/* Hero strip — workspace name + trial countdown. Kept slim so
          the dashboard content below gets the real estate. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workspace
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {tenant.name}
          </h1>
        </div>
        {trialDaysLeft !== null ? (
          <div className="rounded-lg border bg-card px-3 py-1.5 text-xs">
            <span className="font-semibold">{trialDaysLeft}</span>{' '}
            <span className="text-muted-foreground">
              of {TRIAL_DAYS} trial days left
            </span>
          </div>
        ) : null}
      </div>

      {brandProfile?.completedAt == null && (
        <Link
          href={`/t/${params.slug}/settings/brand`}
          className="group block rounded-xl border border-violet-300 bg-gradient-to-r from-violet-50 via-fuchsia-50 to-orange-50 p-4 transition-shadow hover:shadow-md dark:border-violet-800/60 dark:from-violet-950/40 dark:via-fuchsia-950/30 dark:to-orange-950/20"
        >
          <div className="flex items-center gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Set up your brand profile to use AI Campaign Agent
              </p>
              <p className="text-xs text-muted-foreground">
                The agent reads your brand voice + colors when drafting
                campaigns. Takes about 2 minutes.
              </p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      )}

      <OnboardingChecklist
        tenantSlug={params.slug}
        contactsCount={contactsCount}
        segmentsCount={segmentsCount}
        campaignsCount={campaignsCount}
        hasVerifiedSendingDomain={verifiedDomains > 0}
        hasConnectedWhatsapp={!!waAccount}
      />

      <DashboardGrid tenantSlug={params.slug} />
    </div>
  );
}
