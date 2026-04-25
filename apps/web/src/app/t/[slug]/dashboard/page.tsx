import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Mail } from 'lucide-react';

import {
  CampaignSendStatus,
  prisma,
  withTenant,
  type CampaignStatus,
} from '@getyn/db';

import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TRIAL_DAYS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  SENDING: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  SENT: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  PAUSED: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  FAILED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  CANCELED: 'bg-muted text-muted-foreground',
};

/**
 * Tenant dashboard.
 *
 * Four panels:
 *   1. Greeting + trial countdown.
 *   2. Onboarding checklist — five steps reflecting Phase 2 + Phase 3.
 *   3. Stat strip — live audience counts.
 *   4. Recent campaigns — last 5 with status + open rate (Phase 3).
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

  // Counts + recent campaigns in one tenant-scoped transaction.
  const { contactsCount, segmentsCount, suppressedCount, campaignsCount, recentCampaigns } =
    await withTenant(tenant.id, async (tx) => {
      const [contactsCount, segmentsCount, suppressedCount, campaignsCount, recentCampaigns] =
        await Promise.all([
          tx.contact.count({ where: { tenantId: tenant.id, deletedAt: null } }),
          tx.segment.count({ where: { tenantId: tenant.id } }),
          tx.suppressionEntry.count({ where: { tenantId: tenant.id } }),
          tx.campaign.count({ where: { tenantId: tenant.id } }),
          tx.campaign.findMany({
            where: { tenantId: tenant.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              emailCampaign: {
                select: { subject: true },
              },
            },
          }),
        ]);
      return {
        contactsCount,
        segmentsCount,
        suppressedCount,
        campaignsCount,
        recentCampaigns,
      };
    });

  // For each recent campaign, fetch a quick open-rate aggregate. We keep
  // this off the dashboard's hot path by limiting to the 5 visible rows.
  const campaignSummaries = await withTenant(tenant.id, async (tx) => {
    return Promise.all(
      recentCampaigns.map(async (c) => {
        const sentTotal = await tx.campaignSend.count({
          where: {
            tenantId: tenant.id,
            campaignId: c.id,
            status: {
              in: [
                CampaignSendStatus.SENT,
                CampaignSendStatus.DELIVERED,
                CampaignSendStatus.OPENED,
                CampaignSendStatus.CLICKED,
              ],
            },
          },
        });
        const opened = await tx.campaignSend.count({
          where: {
            tenantId: tenant.id,
            campaignId: c.id,
            status: {
              in: [CampaignSendStatus.OPENED, CampaignSendStatus.CLICKED],
            },
          },
        });
        return { campaign: c, sentTotal, opened };
      }),
    );
  });

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
        campaignsCount={campaignsCount}
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Recent campaigns</CardTitle>
          <Link
            href={`/t/${params.slug}/campaigns`}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            All campaigns
            <ArrowRight className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {campaignSummaries.length === 0 ? (
            <div className="py-6 text-center">
              <Mail className="mx-auto mb-2 size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                No campaigns yet — your first one starts here.
              </p>
              <Link
                href={`/t/${params.slug}/campaigns/new`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"
              >
                Create a campaign
                <ArrowRight className="size-3" />
              </Link>
            </div>
          ) : (
            <ul className="divide-y">
              {campaignSummaries.map(({ campaign, sentTotal, opened }) => {
                const openRate =
                  sentTotal === 0 ? null : (opened / sentTotal) * 100;
                return (
                  <li key={campaign.id}>
                    <Link
                      href={`/t/${params.slug}/campaigns/${campaign.id}`}
                      className="flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{campaign.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {campaign.emailCampaign?.subject ?? '—'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                          STATUS_TONE[campaign.status as CampaignStatus] ??
                            STATUS_TONE.DRAFT,
                        )}
                      >
                        {campaign.status}
                      </span>
                      <span className="hidden w-16 text-right text-xs text-muted-foreground sm:block">
                        {openRate !== null ? `${openRate.toFixed(1)}%` : '—'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
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
