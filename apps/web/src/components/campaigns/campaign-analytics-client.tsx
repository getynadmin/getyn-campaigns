'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  ChevronRight,
  Mail,
  MailCheck,
  MailOpen,
  MousePointerClick,
  ShieldOff,
  TriangleAlert,
} from 'lucide-react';

import type { CampaignSendStatusValue } from '@getyn/types';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<CampaignSendStatusValue, string> = {
  QUEUED: 'bg-muted text-muted-foreground',
  SENT: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  DELIVERED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  OPENED: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  CLICKED: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
  BOUNCED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  COMPLAINED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  FAILED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  SUPPRESSED: 'bg-muted text-muted-foreground',
};

const fmtPct = (n: number): string =>
  Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';

export function CampaignAnalyticsClient({
  campaignId,
  tenantSlug,
}: {
  campaignId: string;
  tenantSlug: string;
}): JSX.Element {
  const summaryQ = api.campaign.analyticsSummary.useQuery({ campaignId });
  const timeSeriesQ = api.campaign.analyticsTimeSeries.useQuery({
    campaignId,
    granularity: 'hour',
  });
  const topLinksQ = api.campaign.analyticsTopLinks.useQuery({
    campaignId,
    limit: 10,
  });

  const [recipientFilter, setRecipientFilter] = useState<
    CampaignSendStatusValue | 'ALL'
  >('ALL');
  const recipientsQ = api.campaign.analyticsRecipients.useQuery({
    campaignId,
    status: recipientFilter === 'ALL' ? undefined : recipientFilter,
    limit: 25,
  });

  const summary = summaryQ.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href={`/t/${tenantSlug}/campaigns/${campaignId}`}>
            <ArrowLeft className="mr-2 size-4" />
            Back to campaign
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          {summary?.sentAt
            ? `Sent ${new Date(summary.sentAt).toLocaleString()}`
            : 'Not yet sent'}
        </p>
      </div>

      {/* METRIC ROW */}
      {summaryQ.isLoading || !summary ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric
            label="Sent"
            value={summary.totals.sent.toLocaleString()}
            icon={Mail}
          />
          <Metric
            label="Delivered"
            value={summary.totals.delivered.toLocaleString()}
            sub={`${fmtPct(summary.rates.deliveryRate)} of sent`}
            icon={MailCheck}
          />
          <Metric
            label="Opens"
            value={summary.totals.opened.toLocaleString()}
            sub={`${fmtPct(summary.rates.openRate)} open rate`}
            icon={MailOpen}
            tone="violet"
          />
          <Metric
            label="Clicks"
            value={summary.totals.clicked.toLocaleString()}
            sub={`${fmtPct(summary.rates.clickRate)} click rate`}
            icon={MousePointerClick}
            tone="indigo"
          />
          <Metric
            label="Click-to-open"
            value={fmtPct(summary.rates.clickToOpenRate)}
            sub="of openers clicked"
            icon={MousePointerClick}
          />
          <Metric
            label="Bounces"
            value={summary.totals.bounced.toLocaleString()}
            sub={fmtPct(summary.rates.bounceRate)}
            icon={TriangleAlert}
            tone="amber"
          />
          <Metric
            label="Complaints"
            value={summary.totals.complained.toLocaleString()}
            sub={fmtPct(summary.rates.complaintRate)}
            icon={ShieldOff}
            tone="rose"
          />
          <Metric
            label="Unsubscribed"
            value={summary.totals.unsubscribed.toLocaleString()}
            sub={fmtPct(summary.rates.unsubscribeRate)}
            icon={ShieldOff}
          />
        </div>
      )}

      {/* FUNNEL */}
      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <Funnel
              steps={[
                { label: 'Sent', count: summary.totals.sent },
                { label: 'Delivered', count: summary.totals.delivered },
                { label: 'Opened', count: summary.totals.opened },
                { label: 'Clicked', count: summary.totals.clicked },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* TIME SERIES */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity over time</CardTitle>
        </CardHeader>
        <CardContent>
          {timeSeriesQ.isLoading ? (
            <Skeleton className="h-72" />
          ) : !timeSeriesQ.data || timeSeriesQ.data.buckets.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No events yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={timeSeriesQ.data.buckets.map((b) => ({
                  ts: new Date(b.timestamp).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                  }),
                  Opens: b.opened,
                  Clicks: b.clicked,
                  Bounces: b.bounced,
                }))}
              >
                <defs>
                  <linearGradient id="grad-opens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-clicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="ts" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="Opens"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#grad-opens)"
                />
                <Area
                  type="monotone"
                  dataKey="Clicks"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#grad-clicks)"
                />
                <Area
                  type="monotone"
                  dataKey="Bounces"
                  stroke="#f59e0b"
                  strokeWidth={1}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* TOP LINKS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top links</CardTitle>
        </CardHeader>
        <CardContent>
          {topLinksQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : !topLinksQ.data || topLinksQ.data.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tracked links in this campaign.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topLinksQ.data.links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-xl truncate font-mono text-xs">
                      {l.originalUrl}
                    </TableCell>
                    <TableCell className="text-right">
                      {l.clickCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {fmtPct(l.clickThroughRate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* RECIPIENTS TABLE */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recipients</CardTitle>
            <Select
              value={recipientFilter}
              onValueChange={(v) =>
                setRecipientFilter(v as CampaignSendStatusValue | 'ALL')
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="OPENED">Opened</SelectItem>
                <SelectItem value="CLICKED">Clicked</SelectItem>
                <SelectItem value="BOUNCED">Bounced</SelectItem>
                <SelectItem value="COMPLAINED">Complained</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {recipientsQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : !recipientsQ.data || recipientsQ.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recipients match the filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipientsQ.data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">
                        {row.contact?.firstName ?? ''}{' '}
                        {row.contact?.lastName ?? ''}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                          STATUS_TONE[row.status as CampaignSendStatusValue],
                        )}
                      >
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sentAt
                        ? new Date(row.sentAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.contact ? (
                        <Link
                          href={`/t/${tenantSlug}/contacts/${row.contact.id}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ChevronRight className="size-4" />
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* A/B RESULTS */}
      {summary?.abTest &&
      (summary.abTest as { enabled?: boolean }).enabled === true ? (
        <AbTestResults
          campaignId={campaignId}
          abTest={summary.abTest as Record<string, unknown>}
        />
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'violet' | 'indigo' | 'amber' | 'rose';
}): JSX.Element {
  const toneClass =
    tone === 'violet'
      ? 'text-violet-600 dark:text-violet-300'
      : tone === 'indigo'
        ? 'text-indigo-600 dark:text-indigo-300'
        : tone === 'amber'
          ? 'text-amber-600 dark:text-amber-300'
          : tone === 'rose'
            ? 'text-rose-600 dark:text-rose-300'
            : 'text-muted-foreground';
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className={cn('size-4', toneClass)} />
        </div>
        <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
        {sub ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Funnel({
  steps,
}: {
  steps: { label: string; count: number }[];
}): JSX.Element {
  const max = steps[0]?.count ?? 1;
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const pct = max === 0 ? 0 : (s.count / max) * 100;
        const conversionFromPrev =
          i === 0 ? null : steps[i - 1]!.count === 0
            ? 0
            : s.count / steps[i - 1]!.count;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{s.label}</span>
              <span className="font-mono text-muted-foreground">
                {s.count.toLocaleString()}
                {conversionFromPrev !== null
                  ? ` · ${(conversionFromPrev * 100).toFixed(1)}%`
                  : ''}
              </span>
            </div>
            <div className="h-6 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AbTestResults({
  campaignId,
  abTest,
}: {
  campaignId: string;
  abTest: Record<string, unknown>;
}): JSX.Element {
  // For MVP we render the static config; deriving per-variant rates would
  // mean another query. M9 polish.
  const variants = (abTest.variants as { id: string; subject: string }[]) ?? [];
  const winner = abTest.winnerVariantId as 'A' | 'B' | null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">A/B test results</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {variants.map((v) => (
            <div
              key={v.id}
              className={cn(
                'rounded-lg border p-4',
                winner === v.id
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-border',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Variant {v.id}</span>
                {winner === v.id ? (
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                    Winner
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{v.subject}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Winner metric:{' '}
          <span className="font-medium">
            {String(abTest.winnerMetric ?? 'open_rate')}
          </span>
          {abTest.winnerDecidedAt ? (
            <>
              {' '}
              · Decided{' '}
              {new Date(abTest.winnerDecidedAt as string).toLocaleString()}
            </>
          ) : abTest.status === 'pending' || abTest.status === 'testing' ? (
            ' · Test in progress'
          ) : null}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Per-variant open and click rates land in M9 polish.
        </p>
        {/* campaignId reserved for future per-variant query */}
        <span className="hidden">{campaignId}</span>
      </CardContent>
    </Card>
  );
}
