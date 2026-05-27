'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  Database,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';
import { cn } from '@/lib/utils';

type Status = 'ALL' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
type Source = 'ALL' | 'DIRECT' | 'G_SUITE';

export function AdminTenantsClient(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('ALL');
  const [source, setSource] = useState<Source>('ALL');
  const [suspendedOnly, setSuspendedOnly] = useState(false);

  const { data, isLoading } = adminApi.tenant.list.useQuery({
    ...(status !== 'ALL' ? { status } : {}),
    ...(source !== 'ALL' ? { provisioningSource: source } : {}),
    ...(suspendedOnly ? { suspended: true } : {}),
    ...(search.length >= 2 ? { search } : {}),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Search name / slug / G-Suite org…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="TRIALING">Trialing</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PAST_DUE">Past due</SelectItem>
            <SelectItem value="CANCELED">Canceled</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 rounded border"
            checked={suspendedOnly}
            onChange={(e) => setSuspendedOnly(e.target.checked)}
          />
          Suspended only
        </label>
        <Select value={source} onValueChange={(v) => setSource(v as Source)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All sources</SelectItem>
            <SelectItem value="G_SUITE">G-Suite</SelectItem>
            <SelectItem value="DIRECT">Direct</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Database className="mx-auto size-6 opacity-40" />
          <p className="mt-2">No tenants match.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {(data?.items ?? []).map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/tenants/${t.id}`}
                className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">
                      /{t.slug}
                    </span>
                    <SourceBadge source={t.provisioningSource} />
                    <StatusBadge status={t.billingStatus} />
                    {t.sendingPolicy?.suspendedAt && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-900 dark:bg-rose-950 dark:text-rose-200">
                        <ShieldAlert className="size-3" /> SUSPENDED
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t._count.memberships} members · {t._count.contacts.toLocaleString()} contacts ·{' '}
                    {t._count.campaigns} campaigns
                    {t.whatsAppAccount && (
                      <>
                        {' · WhatsApp '}
                        <span
                          className={cn(
                            t.whatsAppAccount.status === 'CONNECTED'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400',
                          )}
                        >
                          {t.whatsAppAccount.status}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceBadge({
  source,
}: {
  source: 'DIRECT' | 'G_SUITE';
}): JSX.Element {
  return source === 'G_SUITE' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-900 dark:bg-blue-950 dark:text-blue-200">
      <Sparkles className="size-3" /> G-Suite
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
      Direct
    </span>
  );
}

function StatusBadge({
  status,
}: {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
}): JSX.Element {
  const map: Record<typeof status, string> = {
    TRIALING:
      'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ACTIVE:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAST_DUE: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    CANCELED: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
        map[status],
      )}
    >
      {status}
    </span>
  );
}
