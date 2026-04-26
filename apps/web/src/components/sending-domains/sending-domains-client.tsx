'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Globe,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';

import type { Plan } from '@getyn/db';
import {
  sendingDomainCreateSchema,
  type SendingDomainCreateInput,
  type SendingDomainDnsRecord,
  type SendingDomainStatusValue,
} from '@getyn/types';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<SendingDomainStatusValue, string> = {
  PENDING: 'Pending verification',
  VERIFIED: 'Verified',
  FAILED: 'Verification failed',
  SUSPENDED: 'Suspended',
};

const STATUS_TONE: Record<SendingDomainStatusValue, string> = {
  PENDING:
    'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  VERIFIED:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  FAILED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  SUSPENDED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
};

function StatusIcon({ status }: { status: SendingDomainStatusValue }): JSX.Element {
  if (status === 'VERIFIED') return <CheckCircle2 className="size-3.5" />;
  if (status === 'FAILED' || status === 'SUSPENDED')
    return <XCircle className="size-3.5" />;
  return <Loader2 className="size-3.5 animate-pulse" />;
}

export function SendingDomainsClient({
  canManage,
  planAllowsDomains,
  plan,
}: {
  canManage: boolean;
  planAllowsDomains: boolean;
  plan: Plan;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.sendingDomain.list.useQuery({});

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const verify = api.sendingDomain.verify.useMutation({
    onSuccess: (row) => {
      void utils.sendingDomain.list.invalidate();
      if (row.status === 'VERIFIED') {
        toast.success(`${row.domain} is verified.`);
      } else {
        toast.message(
          `Still ${STATUS_LABEL[row.status as SendingDomainStatusValue]}`,
          {
            description:
              'DNS changes can take up to 48h to propagate. Try again later.',
          },
        );
      }
    },
    onError: (err) => toast.error(err.message ?? 'Verification check failed.'),
  });

  const del = api.sendingDomain.delete.useMutation({
    onSuccess: () => {
      void utils.sendingDomain.list.invalidate();
      toast.success('Domain removed.');
    },
    onError: (err) => toast.error(err.message ?? 'Could not remove domain.'),
  });

  const showUpgradeBanner = !planAllowsDomains;

  return (
    <div className="space-y-4">
      {showUpgradeBanner ? (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="font-medium">Custom domains are on Growth and Pro</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your workspace is on{' '}
              <span className="font-medium">{plan}</span>. Custom sending
              domains improve deliverability — switch to Growth or Pro to add
              one. Until then, campaigns send from{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                @getynmail.com
              </code>
              .
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {data
            ? `${data.total} domain${data.total === 1 ? '' : 's'}`
            : '—'}
        </div>
        {canManage && planAllowsDomains ? <NewDomainDialog /> : null}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Globe className="mx-auto mb-2 size-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              No sending domains yet.
            </p>
            {canManage && planAllowsDomains ? (
              <p className="mt-1 text-xs text-muted-foreground/80">
                Add one to send from your own address.
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y">
            {data.items.map((row) => {
              const status = row.status as SendingDomainStatusValue;
              const records =
                (row.dnsRecords as SendingDomainDnsRecord[]) ?? [];
              const isExpanded = expandedId === row.id;
              return (
                <li key={row.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : row.id)
                      }
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <Globe className="size-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{row.domain}</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          STATUS_TONE[status],
                        )}
                      >
                        <StatusIcon status={status} />
                        {STATUS_LABEL[status]}
                      </span>
                      <ChevronDown
                        className={cn(
                          'size-4 text-muted-foreground transition-transform',
                          isExpanded && 'rotate-180',
                        )}
                      />
                    </button>
                    {canManage ? (
                      <>
                        {status !== 'VERIFIED' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => verify.mutate({ id: row.id })}
                            disabled={verify.isPending}
                          >
                            <RefreshCw
                              className={cn(
                                'mr-2 size-3.5',
                                verify.isPending && 'animate-spin',
                              )}
                            />
                            Check status
                          </Button>
                        ) : null}
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
                              onClick={() => setConfirmDeleteId(row.id)}
                            >
                              Remove domain
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    ) : null}
                  </div>
                  {isExpanded ? (
                    <div className="border-t bg-muted/30 px-4 py-4">
                      <div className="mb-3 flex items-start gap-2">
                        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          Add the records below to your DNS provider, then
                          click <span className="font-medium">Check status</span>.
                          DNS changes can take up to 48h to propagate but are
                          usually live within a few minutes.
                        </p>
                      </div>
                      <DnsRecordsTable records={records} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={confirmDeleteId != null}
        onOpenChange={(o) => (o ? null : setConfirmDeleteId(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this sending domain?</DialogTitle>
            <DialogDescription>
              Future campaigns can still be sent — they'll fall back to the
              shared <code className="rounded bg-muted px-1 py-0.5 text-xs">@getynmail.com</code>{' '}
              pool. Active and scheduled campaigns that already reference
              this domain keep their reference; the actual sending uses the
              shared pool from delete-time onward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteId) {
                  del.mutate({ id: confirmDeleteId });
                  setConfirmDeleteId(null);
                }
              }}
              disabled={del.isPending}
            >
              Remove domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewDomainDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const utils = api.useUtils();

  const form = useForm<SendingDomainCreateInput>({
    resolver: zodResolver(sendingDomainCreateSchema),
    defaultValues: { domain: '' },
  });

  const create = api.sendingDomain.create.useMutation({
    onSuccess: () => {
      toast.success('Domain added — copy the DNS records to verify.');
      void utils.sendingDomain.list.invalidate();
      setOpen(false);
      form.reset();
    },
    onError: (err) => toast.error(err.message ?? 'Could not add domain.'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          Add domain
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a sending domain</DialogTitle>
          <DialogDescription>
            We recommend a subdomain like{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              mail.yourcompany.com
            </code>
            . Sending from your apex domain (e.g.{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              yourcompany.com
            </code>
            ) makes other email tools harder to add later.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="domain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Domain</FormLabel>
                  <FormControl>
                    <Input placeholder="mail.yourcompany.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    After saving you'll see DNS records to add at your domain
                    registrar.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add domain'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DnsRecordsTable({
  records,
}: {
  records: SendingDomainDnsRecord[];
}): JSX.Element {
  if (records.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        DNS records will appear here once Resend returns them. Try clicking{' '}
        <span className="font-medium">Check status</span> above.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded border bg-card">
      <table className="w-full text-xs">
        <thead className="border-b bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Type</th>
            <th className="px-3 py-2 text-left font-medium">Host</th>
            <th className="px-3 py-2 text-left font-medium">Value</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="w-10 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((r, i) => (
            <tr key={i} className="font-mono">
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <span className="font-sans font-medium">{r.type}</span>
                  {r.record ? (
                    <span className="font-sans text-[10px] text-muted-foreground">
                      {r.record}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="break-all px-3 py-2">{r.name}</td>
              <td className="break-all px-3 py-2">{r.value}</td>
              <td className="px-3 py-2 font-sans capitalize">
                {r.status === 'verified' ? (
                  <span className="text-emerald-700 dark:text-emerald-300">
                    {r.status}
                  </span>
                ) : r.status === 'failed' ? (
                  <span className="text-rose-700 dark:text-rose-300">
                    {r.status}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{r.status}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(r.value);
                    toast.success('Copied');
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Copy value"
                >
                  <Copy className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
