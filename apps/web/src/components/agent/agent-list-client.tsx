'use client';

import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Mail,
  MessageCircle,
  Sparkles,
  XCircle,
} from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

/**
 * Phase 7 M5 — agent conversation list. Card-per-conversation with
 * channel badge, status pill, title (auto-generated from the goal),
 * and last-message timestamp.
 */
const STATUS_PILL: Record<
  string,
  { label: string; cls: string; icon: typeof CheckCircle2 | null }
> = {
  ACTIVE: {
    label: 'Active',
    cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    icon: null,
  },
  COMPLETED_DRAFT_CREATED: {
    label: 'Draft created',
    cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    icon: CheckCircle2,
  },
  ABANDONED: {
    label: 'Abandoned',
    cls: 'bg-muted text-muted-foreground',
    icon: XCircle,
  },
  FAILED: {
    label: 'Failed',
    cls: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
    icon: XCircle,
  },
};

export function AgentListClient({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const { data, isLoading } = api.agent.listConversations.useQuery({});

  if (isLoading) return <Skeleton className="h-80" />;
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        <Sparkles className="mx-auto mb-2 size-5" />
        No conversations yet. Start one from Campaigns → New.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.map((c) => {
        const pill = STATUS_PILL[c.status] ?? STATUS_PILL.ACTIVE!;
        const Icon = c.channel === 'EMAIL' ? Mail : MessageCircle;
        const label = c.title ?? c.goal ?? 'Untitled conversation';
        const href = `/t/${tenantSlug}/agent/${c.id}`;
        const finalLink =
          c.status === 'COMPLETED_DRAFT_CREATED' && c.producedCampaignId
            ? `/t/${tenantSlug}/campaigns/${c.producedCampaignId}/${
                c.channel === 'EMAIL' ? 'design' : 'whatsapp'
              }`
            : null;
        return (
          <li key={c.id}>
            <Link
              href={finalLink ?? href}
              className="group flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <span
                    className={
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                      pill.cls
                    }
                  >
                    {pill.icon && <pill.icon className="size-2.5" />}
                    {pill.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {c.channel === 'EMAIL' ? 'Email' : 'WhatsApp'} ·{' '}
                  {new Date(c.lastMessageAt).toLocaleString()}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
