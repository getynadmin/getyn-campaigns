'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Eye,
  MessageCircle,
  Slash,
  Snowflake,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

type LaneKey = 'ACTIVE_CONVERSATION' | 'REVIEW_RESPONSE' | 'COOLING_PERIOD' | 'INACTIVE';

const LANES: Array<{
  key: LaneKey;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = [
  {
    key: 'ACTIVE_CONVERSATION',
    label: 'Active Conversation',
    Icon: MessageCircle,
    color: 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20',
  },
  {
    key: 'REVIEW_RESPONSE',
    label: 'Review Response',
    Icon: Eye,
    color: 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20',
  },
  {
    key: 'COOLING_PERIOD',
    label: 'Cooling Period',
    Icon: Snowflake,
    color: 'border-sky-500/40 bg-sky-50/40 dark:bg-sky-950/20',
  },
  {
    key: 'INACTIVE',
    label: 'Inactive Conversation',
    Icon: Slash,
    color: 'border-zinc-400/40 bg-zinc-50/40 dark:bg-zinc-900/40',
  },
];

export function EmailAgentKanban({
  agentId,
  agentName,
  slug,
}: {
  agentId: string;
  agentName: string;
  slug: string;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.emailAgent.board.useQuery(
    { id: agentId },
    { refetchInterval: 15_000 },
  );
  const move = api.emailAgent.moveCard.useMutation({
    onSuccess: () => {
      void utils.emailAgent.board.invalidate({ id: agentId });
    },
    onError: (e) => toast.error(e.message),
  });

  const [openEnrollmentId, setOpenEnrollmentId] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href={`/t/${slug}/automation/agents`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> All agents
          </Link>
          <h1 className="text-2xl font-semibold">{agentName}</h1>
          <p className="text-sm text-muted-foreground">
            Conversation board — drag or use the arrows to move a card.
          </p>
        </div>
        <Link
          href={`/t/${slug}/automation/agents/${agentId}`}
          className="text-sm text-primary hover:underline"
        >
          Edit agent
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const rows = data?.[lane.key] ?? [];
          return (
            <section
              key={lane.key}
              className={`flex flex-col rounded-lg border ${lane.color}`}
            >
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <lane.Icon className="size-4" />
                <span className="text-sm font-semibold">{lane.label}</span>
                <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[11px] font-medium">
                  {isLoading ? '…' : rows.length}
                </span>
              </header>
              <div className="flex-1 space-y-2 p-2">
                {isLoading ? (
                  <>
                    <Skeleton className="h-20" />
                    <Skeleton className="h-20" />
                  </>
                ) : rows.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    No cards
                  </p>
                ) : (
                  rows.map((r) => (
                    <Card
                      key={r.id}
                      row={r}
                      laneKey={lane.key}
                      onOpen={() => setOpenEnrollmentId(r.id)}
                      onMove={(to) => move.mutate({ enrollmentId: r.id, to })}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      <ThreadDialog
        enrollmentId={openEnrollmentId}
        onClose={() => setOpenEnrollmentId(null)}
        onMove={(to) =>
          openEnrollmentId
            ? move.mutate({ enrollmentId: openEnrollmentId, to })
            : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------

interface BoardRow {
  id: string;
  conversationStatus: LaneKey;
  status: string;
  currentStep: number;
  lastSentAt: Date | string | null;
  lastInboundAt: Date | string | null;
  suggestedReplyHint: string | null;
  contact: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  messages: Array<{
    id: string;
    direction: 'INBOUND' | 'OUTBOUND';
    subject: string;
    createdAt: Date | string;
    bodyText: string;
  }>;
}

function Card({
  row,
  laneKey,
  onOpen,
  onMove,
}: {
  row: BoardRow;
  laneKey: LaneKey;
  onOpen: () => void;
  onMove: (to: LaneKey) => void;
}): JSX.Element {
  const name = row.contact.firstName
    ? `${row.contact.firstName} ${row.contact.lastName ?? ''}`.trim()
    : row.contact.email ?? '(no email)';
  const last = row.messages[0];
  const idx = LANES.findIndex((l) => l.key === laneKey);
  const prev = LANES[idx - 1];
  const next = LANES[idx + 1];
  return (
    <div
      className="group rounded-md border bg-background p-2.5 shadow-sm transition hover:shadow-md"
    >
      <button
        onClick={onOpen}
        className="block w-full text-left"
      >
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            step {row.currentStep}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {row.contact.email}
        </p>
        {last && (
          <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
            <span className="font-medium">
              {last.direction === 'INBOUND' ? '← reply · ' : '→ sent · '}
            </span>
            {last.bodyText.slice(0, 120)}
          </p>
        )}
        {row.suggestedReplyHint && laneKey === 'REVIEW_RESPONSE' && (
          <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-[10px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Sparkles className="mr-1 inline size-2.5" />
            Hint pending
          </p>
        )}
      </button>
      <div className="mt-2 flex items-center justify-between border-t pt-1.5 opacity-0 transition group-hover:opacity-100">
        <button
          disabled={!prev}
          onClick={() => prev && onMove(prev.key)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          title={prev ? `Move to ${prev.label}` : 'First column'}
        >
          <ArrowLeft className="size-3" />
        </button>
        <span className="text-[10px] text-muted-foreground">
          {row.lastInboundAt ? (
            <>
              <Clock className="mr-0.5 inline size-2.5" />
              {new Date(row.lastInboundAt).toLocaleDateString()}
            </>
          ) : (
            '—'
          )}
        </span>
        <button
          disabled={!next}
          onClick={() => next && onMove(next.key)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          title={next ? `Move to ${next.label}` : 'Last column'}
        >
          <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

function ThreadDialog({
  enrollmentId,
  onClose,
  onMove,
}: {
  enrollmentId: string | null;
  onClose: () => void;
  onMove: (to: LaneKey) => void;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.emailAgent.thread.useQuery(
    { enrollmentId: enrollmentId ?? '' },
    { enabled: !!enrollmentId },
  );
  const submitHint = api.emailAgent.submitSuggestedReply.useMutation({
    onSuccess: () => {
      toast.success('Hint submitted — agent will draft a reply within a minute.');
      void utils.emailAgent.board.invalidate();
      void utils.emailAgent.thread.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const [hint, setHint] = useState('');

  const name = data?.contact.firstName
    ? `${data.contact.firstName} ${data.contact.lastName ?? ''}`.trim()
    : (data?.contact.email ?? '');

  return (
    <Dialog open={!!enrollmentId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="truncate">{name}</span>
            {data && (
              <span className="text-xs font-normal text-muted-foreground">
                {data.conversationStatus.replaceAll('_', ' ').toLowerCase()}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="mb-4 text-xs text-muted-foreground">
              {data.contact.email} · {data.messages.length} messages
            </div>

            {/* Outlook-style thread */}
            <div className="space-y-3">
              {data.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg border p-3 ${
                    m.direction === 'INBOUND'
                      ? 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold">
                      {m.direction === 'INBOUND'
                        ? `← ${data.contact.email}`
                        : `→ ${data.emailAgent.fromName} <${data.emailAgent.fromEmail}>`}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(m.sentAt ?? m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mb-2 text-sm font-medium">{m.subject}</p>
                  <div
                    className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-foreground/90 dark:prose-invert"
                  >
                    {m.bodyText}
                  </div>
                </div>
              ))}
            </div>

            {data.conversationStatus === 'REVIEW_RESPONSE' && (
              <div className="mt-6 space-y-2 rounded-lg border border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/20">
                <p className="text-sm font-semibold">Suggest a reply</p>
                <p className="text-xs text-muted-foreground">
                  Tell the agent what to include (context, pricing, availability,
                  tone adjustment). It&apos;ll weave your hint into the next
                  draft, send it, and move the card back to Active.
                </p>
                <textarea
                  rows={4}
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  placeholder="e.g. Mention that the September AI batch is full but October has open seats. Ask if they'd like a call this week."
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      submitHint.mutate({
                        enrollmentId: enrollmentId!,
                        hint: hint.trim(),
                      })
                    }
                    disabled={!hint.trim() || submitHint.isPending}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Submit hint & resume
                  </Button>
                  <Button variant="outline" onClick={() => onMove('INACTIVE')}>
                    Mark inactive
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
