'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Loader2,
  LogOut,
  MapPin,
  Monitor,
  Shield,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Phase 5 M2 — active-sessions panel.
 *
 * Three primary affordances:
 *   1. Show this device + every other signed-in device with last-seen
 *      timestamps. Revoked rows kept for 30 days as audit trail.
 *   2. "Revoke" per remote session — server validates target is not
 *      the current session.
 *   3. "Sign out everywhere else" — bulk-revoke all non-current
 *      sessions. Current device stays signed in.
 */

export function SessionsClient(): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.userSessions.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const revoke = api.userSessions.revoke.useMutation({
    onSuccess: () => {
      toast.success('Session revoked.');
      void utils.userSessions.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const revokeAll = api.userSessions.revokeAllOthers.useMutation({
    onSuccess: ({ count }) => {
      toast.success(
        count === 0
          ? 'No other sessions to revoke.'
          : `Revoked ${count} other ${count === 1 ? 'device' : 'devices'}.`,
      );
      setConfirmRevokeAll(false);
      void utils.userSessions.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      setConfirmRevokeAll(false);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const items = data ?? [];
  const active = items.filter((s) => !s.revokedAt);
  const revoked = items.filter((s) => s.revokedAt !== null);
  const otherActiveCount = active.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Shield className="mx-auto size-6 opacity-40" />
          <p className="mt-2">No active sessions.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {active.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onRevoke={() => revoke.mutate({ id: s.id })}
              revoking={revoke.isPending && revoke.variables?.id === s.id}
            />
          ))}
        </ul>
      )}

      {otherActiveCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmRevokeAll(true)}
          >
            <LogOut className="mr-2 size-3.5" />
            Sign out everywhere else
          </Button>
        </div>
      )}

      {revoked.length > 0 && (
        <details className="rounded-lg border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Recently revoked ({revoked.length})
          </summary>
          <ul className="mt-3 space-y-2 text-xs">
            {revoked.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span>
                  {s.deviceLabel ?? 'Unknown device'} ·{' '}
                  <span className="text-muted-foreground">
                    revoked {new Date(s.revokedAt!).toLocaleString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog
        open={confirmRevokeAll}
        onOpenChange={(o) => setConfirmRevokeAll(o)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out everywhere else?</DialogTitle>
            <DialogDescription>
              All other devices signed into your Getyn account will be
              signed out on their next request. This device stays signed in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRevokeAll(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeAll.isPending}
              onClick={() => revokeAll.mutate()}
            >
              {revokeAll.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Sign out everywhere else
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionRow({
  session: s,
  onRevoke,
  revoking,
}: {
  session: {
    id: string;
    provider: string;
    deviceLabel: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    issuedAt: Date | string;
    lastSeenAt: Date | string;
    expiresAt: Date | string;
    revokedAt: Date | string | null;
    isCurrent: boolean;
  };
  onRevoke: () => void;
  revoking: boolean;
}): JSX.Element {
  const lastSeenMs = Date.now() - new Date(s.lastSeenAt).getTime();
  const lastSeen = formatRelative(lastSeenMs);
  return (
    <li
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border bg-card p-4',
        s.isCurrent && 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid size-9 place-items-center rounded-md',
            s.isCurrent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Monitor className="size-4" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {s.deviceLabel ?? 'Unknown device'}
            </span>
            {s.isCurrent && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                This device
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              · {s.provider.toLowerCase()}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>Last active {lastSeen}</span>
            {s.ipAddress && (
              <span className="flex items-center gap-0.5">
                <MapPin className="size-3" /> {s.ipAddress}
              </span>
            )}
          </div>
          {s.userAgent && (
            <p className="line-clamp-1 text-[10px] text-muted-foreground/70">
              {s.userAgent}
            </p>
          )}
        </div>
      </div>
      {!s.isCurrent && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          disabled={revoking}
        >
          {revoking ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          <span className="ml-1 hidden sm:inline">Revoke</span>
        </Button>
      )}
    </li>
  );
}

function formatRelative(ms: number): string {
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Silence unused-import warning when icon is conditionally rendered:
void AlertCircle;
