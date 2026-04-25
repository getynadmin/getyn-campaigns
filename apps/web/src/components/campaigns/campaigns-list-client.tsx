'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Mail,
  Plus,
  Search,
} from 'lucide-react';

import type { CampaignStatusValue } from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<CampaignStatusValue, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  SENDING: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  SENT: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  PAUSED: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  FAILED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  CANCELED: 'bg-muted text-muted-foreground',
};

export function CampaignsListClient({
  tenantSlug,
  canCreate,
}: {
  tenantSlug: string;
  canCreate: boolean;
}): JSX.Element {
  const [status, setStatus] = useState<CampaignStatusValue | 'ALL'>('ALL');
  const [rawSearch, setRawSearch] = useState('');

  const { data, isLoading } = api.campaign.list.useQuery({
    status: status === 'ALL' ? undefined : status,
    search: rawSearch || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search by campaign name"
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as CampaignStatusValue | 'ALL')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SCHEDULED">Scheduled</SelectItem>
            <SelectItem value="SENDING">Sending</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="CANCELED">Canceled</SelectItem>
          </SelectContent>
        </Select>
        {canCreate ? (
          <Button asChild>
            <Link href={`/t/${tenantSlug}/campaigns/new`}>
              <Plus className="mr-2 size-4" />
              New campaign
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="text-xs text-muted-foreground">
        {data ? `${data.total} campaign${data.total === 1 ? '' : 's'}` : '—'}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="mx-auto mb-2 size-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">No campaigns yet.</p>
            {canCreate ? (
              <p className="mt-1 text-xs text-muted-foreground/80">
                Create your first one — it'll appear here as a draft.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y">
            {data.items.map((row) => {
              const ec = row.emailCampaign;
              const abEnabled =
                ec?.abTest && (ec.abTest as { enabled?: boolean }).enabled;
              return (
                <li key={row.id}>
                  <Link
                    href={`/t/${tenantSlug}/campaigns/${row.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{row.name}</p>
                        {abEnabled ? (
                          <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-900 dark:bg-violet-950 dark:text-violet-200">
                            A/B
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {ec?.subject ?? '—'} · segment{' '}
                        <span className="font-medium">
                          {row.segment?.name ?? '—'}
                        </span>
                      </p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                        STATUS_TONE[row.status as CampaignStatusValue],
                      )}
                    >
                      {row.status}
                    </span>
                    <p className="hidden w-32 text-right text-xs text-muted-foreground sm:block">
                      {row.sentAt
                        ? `Sent ${new Date(row.sentAt).toLocaleDateString()}`
                        : row.scheduledAt
                          ? `Scheduled ${new Date(row.scheduledAt).toLocaleDateString()}`
                          : `Created ${new Date(row.createdAt).toLocaleDateString()}`}
                    </p>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
