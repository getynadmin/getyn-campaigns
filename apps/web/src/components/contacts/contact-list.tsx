'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Role } from '@getyn/db';
import type { SubscriptionStatusValue } from '@getyn/types';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/trpc';

import { StatusBadge } from './status-badge';
import { TagChip } from './tag-chip';

/**
 * Debounce a React state value. We re-render every keystroke but only
 * re-query after 300ms of quiet, so the contact search input feels
 * responsive without spamming the backend.
 */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useMemo(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const STATUS_OPTIONS: { label: string; value: SubscriptionStatusValue | 'ALL' }[] = [
  { label: 'All statuses', value: 'ALL' },
  { label: 'Subscribed', value: 'SUBSCRIBED' },
  { label: 'Unsubscribed', value: 'UNSUBSCRIBED' },
  { label: 'Bounced', value: 'BOUNCED' },
  { label: 'Complained', value: 'COMPLAINED' },
  { label: 'Pending', value: 'PENDING' },
];

/**
 * Contact list with search, status filter, tag filter, and cursor-based
 * pagination. Keeps pagination state in component state (not URL) for
 * Phase 2 — linkable filters can land in Milestone 8 polish.
 */
export function ContactList({
  tenantSlug,
  currentRole,
}: {
  tenantSlug: string;
  currentRole: Role;
}): JSX.Element {
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch, 300);
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatusValue | 'ALL'>(
    'ALL',
  );
  const [tagFilter, setTagFilter] = useState<string | 'ALL'>('ALL');
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);

  const tagList = api.tags.list.useQuery();
  const { data, isLoading, isFetching } = api.contacts.list.useQuery({
    search: search || undefined,
    emailStatus: statusFilter === 'ALL' ? undefined : statusFilter,
    tagIds: tagFilter === 'ALL' ? undefined : [tagFilter],
    limit: 25,
    cursor: cursor ?? undefined,
  });

  // Any filter change resets pagination.
  const resetCursor = (): void => {
    setCursor(null);
    setCursorStack([null]);
  };

  const onSearch = (v: string): void => {
    setRawSearch(v);
    resetCursor();
  };
  const onStatus = (v: SubscriptionStatusValue | 'ALL'): void => {
    setStatusFilter(v);
    resetCursor();
  };
  const onTag = (v: string | 'ALL'): void => {
    setTagFilter(v);
    resetCursor();
  };
  const goNext = (): void => {
    if (data?.nextCursor) {
      setCursor(data.nextCursor);
      setCursorStack((s) => [...s, data.nextCursor]);
    }
  };
  const goPrev = (): void => {
    if (cursorStack.length <= 1) return;
    const next = [...cursorStack];
    next.pop();
    setCursor(next[next.length - 1] ?? null);
    setCursorStack(next);
  };

  const canEdit =
    currentRole === Role.OWNER ||
    currentRole === Role.ADMIN ||
    currentRole === Role.EDITOR;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={rawSearch}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => onStatus(v as typeof statusFilter)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={onTag}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All tags</SelectItem>
            {(tagList.data ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {data ? `${data.total.toLocaleString()} contact${data.total === 1 ? '' : 's'}` : '—'}
        </span>
        {isFetching && !isLoading ? <span>Refreshing…</span> : null}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[32%]">Contact</TableHead>
              <TableHead>Email status</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-7 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ) : !data || data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                  No contacts match the current filters.
                  {canEdit ? ' Add your first contact with the button above.' : ''}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((c) => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
                const display = name || c.email || c.phone || 'Unnamed contact';
                const secondary = name && (c.email || c.phone);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/t/${tenantSlug}/contacts/${c.id}`}
                        className="block hover:underline"
                      >
                        <p className="text-sm font-medium">{display}</p>
                        {secondary ? (
                          <p className="text-xs text-muted-foreground">
                            {c.email ?? c.phone}
                          </p>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.emailStatus} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <TagChip key={t.id} tag={t} size="sm" />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={goPrev}
          disabled={cursorStack.length <= 1 || isFetching}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={goNext}
          disabled={!data?.nextCursor || isFetching}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
