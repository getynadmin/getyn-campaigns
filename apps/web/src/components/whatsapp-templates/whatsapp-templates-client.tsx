'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MessageSquare,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Status =
  | 'ALL'
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED';

const STATUS_LABEL: Record<Exclude<Status, 'ALL'>, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending Meta review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Paused',
  DISABLED: 'Disabled',
};

const STATUS_TONE: Record<Exclude<Status, 'ALL'>, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING:
    'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  APPROVED:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  PAUSED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  DISABLED: 'bg-muted text-muted-foreground line-through',
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
};

export function WhatsAppTemplatesClient({
  tenantSlug,
  canManage,
  canAuthor,
  accountConnected,
}: {
  tenantSlug: string;
  canManage: boolean;
  canAuthor: boolean;
  accountConnected: boolean;
}): JSX.Element {
  const [status, setStatus] = useState<Status>('ALL');
  const utils = api.useUtils();
  const { data, isLoading } = api.whatsAppTemplate.list.useQuery({
    status: status === 'ALL' ? undefined : status,
  });

  const sync = api.whatsAppTemplate.syncNow.useMutation({
    onSuccess: (s) => {
      toast.success(
        `Synced — ${s.created} new, ${s.updated} updated, ${s.linked} linked.`,
      );
      void utils.whatsAppTemplate.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const dup = api.whatsAppTemplate.duplicate.useMutation({
    onSuccess: () => {
      toast.success('Duplicated as draft.');
      void utils.whatsAppTemplate.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const del = api.whatsAppTemplate.delete.useMutation({
    onSuccess: () => {
      toast.success('Template deleted.');
      void utils.whatsAppTemplate.list.invalidate();
      setConfirmDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  if (!accountConnected) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
          <PlugZap className="size-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-base font-semibold">
          Connect WhatsApp first
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Templates are scoped to a WhatsApp Business Account.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/t/${tenantSlug}/settings/channels/whatsapp`}>
            Go to WhatsApp settings
          </Link>
        </Button>
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={status}
          onValueChange={(v) => setStatus(v as Status)}
          className="overflow-x-auto"
        >
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="DRAFT">Drafts</TabsTrigger>
            <TabsTrigger value="PENDING">Pending</TabsTrigger>
            <TabsTrigger value="APPROVED">Approved</TabsTrigger>
            <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
            <TabsTrigger value="DISABLED">Disabled</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || !canManage}
          >
            {sync.isPending ? (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-3.5" />
            )}
            Sync from Meta
          </Button>
          {canAuthor && (
            <Button asChild size="sm">
              <Link
                href={`/t/${tenantSlug}/settings/channels/whatsapp/templates/new`}
              >
                <Plus className="mr-2 size-3.5" /> New template
              </Link>
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tenantSlug={tenantSlug}
          canAuthor={canAuthor}
          status={status}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/t/${tenantSlug}/settings/channels/whatsapp/templates/${t.id}/edit`}
                    className="block truncate font-mono text-sm font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {t.language} · {CATEGORY_LABEL[t.category] ?? t.category}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                    STATUS_TONE[t.status as Exclude<Status, 'ALL'>],
                  )}
                >
                  <StatusIcon status={t.status} />
                  {STATUS_LABEL[t.status as Exclude<Status, 'ALL'>] ?? t.status}
                </span>
              </div>
              {t.rejectionReason && (
                <p className="line-clamp-2 text-xs text-rose-700 dark:text-rose-300">
                  {t.rejectionReason}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <span className="text-[10px] text-muted-foreground">
                  Updated {new Date(t.updatedAt).toLocaleDateString()}
                </span>
                <div className="flex gap-1">
                  {canAuthor && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Duplicate as draft"
                      onClick={() => dup.mutate({ id: t.id })}
                      disabled={dup.isPending}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => setConfirmDeleteId(t.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={Boolean(confirmDeleteId)}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              We&apos;ll soft-delete locally and ask Meta to delete the
              template too. Campaigns that already sent using this template
              keep their analytics.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteId)
                  del.mutate({ id: confirmDeleteId });
              }}
              disabled={del.isPending}
            >
              {del.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusIcon({ status }: { status: string }): JSX.Element {
  if (status === 'APPROVED') return <CheckCircle2 className="size-3" />;
  if (status === 'REJECTED' || status === 'DISABLED')
    return <XCircle className="size-3" />;
  if (status === 'PENDING') return <Clock className="size-3 animate-pulse" />;
  return <MessageSquare className="size-3" />;
}

function EmptyState({
  tenantSlug,
  canAuthor,
  status,
}: {
  tenantSlug: string;
  canAuthor: boolean;
  status: Status;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center">
      <MessageSquare className="mx-auto size-8 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-semibold">
        {status === 'ALL'
          ? 'No templates yet'
          : `No ${status.toLowerCase()} templates`}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        Templates are required for outbound WhatsApp campaigns. Author one
        in our UI or sync from Meta if you&apos;ve already created some in
        Business Manager.
      </p>
      {canAuthor && (
        <Button asChild className="mt-4" size="sm">
          <Link
            href={`/t/${tenantSlug}/settings/channels/whatsapp/templates/new`}
          >
            <Plus className="mr-2 size-3.5" /> New template
          </Link>
        </Button>
      )}
    </div>
  );
}
