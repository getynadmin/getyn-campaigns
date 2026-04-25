'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MoreHorizontal, Search, ShieldOff } from 'lucide-react';

import { Role } from '@getyn/db';
import type {
  ChannelValue,
  SuppressionReasonValue,
} from '@getyn/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { cn } from '@/lib/utils';

/**
 * Suppression list browser.
 *
 * The list is mostly auto-populated — Phase 2 only ever adds rows from
 * status flips today, and Phase 3 will add bounce/complaint feedback. The
 * UI gives admins a way to review and manually remove entries (e.g. a
 * mistakenly bounced address that's been confirmed-clean by the user).
 *
 * We use the same cursor + cursorStack pattern the contacts list uses so
 * the back button behaves predictably.
 */

const CHANNEL_LABEL: Record<ChannelValue, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
};

const REASON_LABEL: Record<SuppressionReasonValue, string> = {
  UNSUBSCRIBED: 'Unsubscribed',
  BOUNCED: 'Bounced',
  COMPLAINED: 'Complained',
  MANUAL: 'Manual',
  IMPORT: 'Import',
};

const REASON_TONE: Record<SuppressionReasonValue, string> = {
  UNSUBSCRIBED: 'bg-muted text-muted-foreground',
  BOUNCED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  COMPLAINED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  MANUAL: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  IMPORT: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
};

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useMemo(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function SuppressionList({
  currentRole,
}: {
  currentRole: Role;
}): JSX.Element {
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch, 300);
  const [channel, setChannel] = useState<ChannelValue | 'ALL'>('ALL');
  const [reason, setReason] = useState<SuppressionReasonValue | 'ALL'>('ALL');
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);

  const utils = api.useUtils();
  const { data, isLoading, isFetching } = api.suppression.list.useQuery({
    search: search || undefined,
    channel: channel === 'ALL' ? undefined : channel,
    reason: reason === 'ALL' ? undefined : reason,
    limit: 25,
    cursor: cursor ?? undefined,
  });

  const canManage =
    currentRole === Role.OWNER || currentRole === Role.ADMIN;

  const del = api.suppression.delete.useMutation({
    onSuccess: () => {
      toast.success('Removed from suppression list.');
      void utils.suppression.list.invalidate();
    },
    onError: (err) => toast.error(err.message ?? 'Could not remove entry.'),
  });

  const [confirmId, setConfirmId] = useState<string | null>(null);

  const resetCursor = (): void => {
    setCursor(null);
    setCursorStack([null]);
  };
  const onSearch = (v: string): void => {
    setRawSearch(v);
    resetCursor();
  };
  const onChannel = (v: ChannelValue | 'ALL'): void => {
    setChannel(v);
    resetCursor();
  };
  const onReason = (v: SuppressionReasonValue | 'ALL'): void => {
    setReason(v);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={rawSearch}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search address"
            className="pl-9"
          />
        </div>
        <Select
          value={channel}
          onValueChange={(v) => onChannel(v as ChannelValue | 'ALL')}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All channels</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="SMS">SMS</SelectItem>
            <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={reason}
          onValueChange={(v) => onReason(v as SuppressionReasonValue | 'ALL')}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All reasons</SelectItem>
            <SelectItem value="UNSUBSCRIBED">Unsubscribed</SelectItem>
            <SelectItem value="BOUNCED">Bounced</SelectItem>
            <SelectItem value="COMPLAINED">Complained</SelectItem>
            <SelectItem value="MANUAL">Manual</SelectItem>
            <SelectItem value="IMPORT">Import</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {data
            ? `${data.total.toLocaleString()} entr${data.total === 1 ? 'y' : 'ies'}`
            : '—'}
        </span>
        {isFetching && !isLoading ? <span>Refreshing…</span> : null}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Added</TableHead>
              {canManage ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={canManage ? 5 : 4}>
                      <Skeleton className="h-7 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ) : !data || data.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canManage ? 5 : 4}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  <ShieldOff className="mx-auto mb-2 size-6 text-muted-foreground/60" />
                  No suppressed addresses match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    {row.value}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {CHANNEL_LABEL[row.channel as ChannelValue]}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                        REASON_TONE[row.reason as SuppressionReasonValue],
                      )}
                    >
                      {REASON_LABEL[row.reason as SuppressionReasonValue]}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-rose-600"
                            onClick={() => setConfirmId(row.id)}
                          >
                            Remove from list
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
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

      <Dialog
        open={confirmId != null}
        onOpenChange={(o) => (o ? null : setConfirmId(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from suppression list?</DialogTitle>
            <DialogDescription>
              The address will become eligible for sends again. Removing this
              row does NOT auto-resubscribe the matching contact — that's a
              separate edit on the contact's profile.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmId) {
                  del.mutate({ id: confirmId });
                  setConfirmId(null);
                }
              }}
              disabled={del.isPending}
            >
              Remove entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
