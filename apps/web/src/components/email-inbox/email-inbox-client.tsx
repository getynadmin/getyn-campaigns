'use client';

import { useState } from 'react';
import { Mail, AlertTriangle, CheckCircle2, Sparkles, Workflow } from 'lucide-react';

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

type Filter =
  | 'ALL'
  | 'UNMATCHED'
  | 'CAMPAIGN_SEND'
  | 'AGENT_ENROLLMENT'
  | 'AUTOMATION_ENROLLMENT';

/**
 * Diagnostic Inbox surface. Ops-facing: shows every reply landing in
 * reply.getyn.com, how routing decided to bucket it, and — for
 * unmatched rows — why. Click a row to see raw payload.
 */
export function EmailInboxClient(): JSX.Element {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = api.emailInbox.list.useQuery({ filter });
  const detail = api.emailInbox.get.useQuery(
    { id: selectedId ?? '' },
    { enabled: selectedId !== null },
  );

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Email inbox</h1>
          <p className="text-sm text-muted-foreground">
            Replies to campaigns, drip messages, and email-agent conversations.
            Diagnostic view — the agent approval queue lives in Automation → Email
            Agent.
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All replies</SelectItem>
            <SelectItem value="CAMPAIGN_SEND">Campaign replies</SelectItem>
            <SelectItem value="AGENT_ENROLLMENT">Email-agent replies</SelectItem>
            <SelectItem value="AUTOMATION_ENROLLMENT">Automation replies</SelectItem>
            <SelectItem value="UNMATCHED">Unmatched</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
        <div className="min-w-0 rounded-lg border bg-card">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Mail className="mx-auto size-6 opacity-40" />
              <p className="mt-2">No replies yet.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {data?.items.map((row) => (
                <li key={row.id}>
                  <button
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
                      selectedId === row.id && 'bg-muted/60',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <MatchIcon match={row.matchedTo} />
                        <span className="truncate text-sm font-medium">
                          {row.fromName ?? row.fromAddress}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.subject || '(no subject)'}
                      </p>
                      {row.processError && (
                        <p className="mt-0.5 truncate text-[11px] text-rose-700">
                          {row.processError}
                        </p>
                      )}
                    </div>
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      {formatTime(row.receivedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 rounded-lg border bg-card p-4">
          {selectedId === null ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Select a reply to see its details.
            </p>
          ) : detail.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.data ? (
            <DetailPane row={detail.data} />
          ) : (
            <p className="text-sm text-muted-foreground">Not found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchIcon({ match }: { match: string }): JSX.Element {
  if (match === 'CAMPAIGN_SEND') {
    return <CheckCircle2 className="size-4 text-emerald-600" />;
  }
  if (match === 'AGENT_ENROLLMENT') {
    return <Sparkles className="size-4 text-violet-600" />;
  }
  if (match === 'AUTOMATION_ENROLLMENT') {
    return <Workflow className="size-4 text-sky-600" />;
  }
  return <AlertTriangle className="size-4 text-amber-600" />;
}

function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return date.toLocaleDateString();
}

type DetailRow = {
  id: string;
  fromAddress: string;
  fromName: string | null;
  toAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  matchedTo: string;
  processError: string | null;
  receivedAt: Date | string;
  campaignSend: {
    id: string;
    campaignId: string;
    campaign: { name: string };
  } | null;
};

function DetailPane({ row }: { row: DetailRow }): JSX.Element {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">From</p>
        <p>
          {row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">To</p>
        <p className="break-all font-mono text-xs">{row.toAddress}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Subject</p>
        <p>{row.subject || '(no subject)'}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Routing</p>
        <p>
          <MatchLabel match={row.matchedTo} />
          {row.processError && (
            <span className="ml-2 text-rose-700">— {row.processError}</span>
          )}
        </p>
        {row.campaignSend && (
          <p className="mt-1 text-xs text-muted-foreground">
            Campaign: {row.campaignSend.campaign.name}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Body</p>
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-muted/30 p-2 font-sans text-xs">
          {row.bodyText || '(empty)'}
        </pre>
      </div>
    </div>
  );
}

function MatchLabel({ match }: { match: string }): JSX.Element {
  const labels: Record<string, string> = {
    CAMPAIGN_SEND: 'Matched to campaign send',
    AGENT_ENROLLMENT: 'Matched to email-agent enrollment',
    AUTOMATION_ENROLLMENT: 'Matched to automation enrollment',
    UNMATCHED: 'Unmatched',
  };
  return <span>{labels[match] ?? match}</span>;
}
