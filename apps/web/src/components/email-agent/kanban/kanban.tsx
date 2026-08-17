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
        <div className="flex items-center gap-2">
          <TestAgentButton agentId={agentId} />
          <BulkEnrollButton agentId={agentId} />
          <Link
            href={`/t/${slug}/automation/agents/${agentId}`}
            className="text-sm text-primary hover:underline"
          >
            Edit agent
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const rows = (data?.lanes[lane.key] ?? []) as BoardRow[];
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
              {/* Fixed viewport ~10 cards; the column scrolls internally
                  so the page itself stays a single screen even at 18k
                  cards. */}
              <div className="max-h-[calc(100vh-260px)] min-h-[240px] flex-1 space-y-2 overflow-y-auto p-2">
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
                      maxFollowUps={data?.maxFollowUps ?? 3}
                      onOpen={() => setOpenEnrollmentId(r.id)}
                      onMove={(to) => move.mutate({ enrollmentId: r.id, to })}
                    />
                  ))
                )}
              </div>
              {rows.length > 10 && (
                <div className="border-t px-3 py-1 text-center text-[10px] text-muted-foreground">
                  Scroll to see all {rows.length}
                </div>
              )}
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

// Compact relative time — "3d", "5h", "just now". Avoids pulling in a
// heavy i18n formatter for a tag that has to fit inside a 200px card.
function relTime(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.round(days / 30);
  return `${mo}mo ago`;
}

function TestAgentButton({ agentId }: { agentId: string }): JSX.Element {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const enroll = api.emailAgent.enrollByEmail.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.alreadyEnrolled
          ? 'Already enrolled — check the Active column.'
          : 'Enrolled — initial email fires within a minute.',
      );
      void utils.emailAgent.board.invalidate({ id: agentId });
      setOpen(false);
      setEmail('');
      setFirstName('');
      setLastName('');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-emerald-500/60 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
        onClick={() => setOpen(true)}
      >
        Test agent
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send a test to any email</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            The recipient becomes a real enrollment on the board so you
            can watch the send, any reply, and the state transitions
            end-to-end. Safe to re-run — already-enrolled emails are
            deduped.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="First name (optional)"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
            <input
              placeholder="Last name (optional)"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <input
            type="email"
            placeholder="test@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                enroll.mutate({
                  emailAgentId: agentId,
                  email,
                  firstName: firstName || undefined,
                  lastName: lastName || undefined,
                })
              }
              disabled={!email.trim() || enroll.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {enroll.isPending ? 'Enrolling…' : 'Send test'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BulkEnrollButton({ agentId }: { agentId: string }): JSX.Element {
  const utils = api.useUtils();
  const segments = api.emailAgent.segmentOptions.useQuery();
  const [open, setOpen] = useState(false);
  const [segmentId, setSegmentId] = useState<string>('');
  const enroll = api.emailAgent.enrollFromSegment.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Enrolled ${r.enrolled.toLocaleString()} · skipped ${r.skipped.toLocaleString()} already enrolled.`,
      );
      void utils.emailAgent.board.invalidate({ id: agentId });
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Bulk enrol from segment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enrol every contact in a segment</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            The agent will draft an initial email for each new contact within
            the next minute. Already-enrolled contacts are skipped.
          </p>
          <select
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Choose a segment…</option>
            {(segments.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                enroll.mutate({ emailAgentId: agentId, segmentId })
              }
              disabled={!segmentId || enroll.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {enroll.isPending ? 'Enrolling…' : 'Enrol'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface BoardRow {
  id: string;
  conversationStatus: LaneKey;
  status: string;
  currentStep: number;
  lastSentAt: Date | string | null;
  lastInboundAt: Date | string | null;
  cooldownUntil?: Date | string | null;
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
  inboundCount?: number;
}

function Card({
  row,
  laneKey,
  maxFollowUps,
  onOpen,
  onMove,
}: {
  row: BoardRow;
  laneKey: LaneKey;
  maxFollowUps: number;
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
  // Step 0 = initial email queued/sent; step 1..N = follow-ups.
  // Show "N of MAX+1 sent" so the operator can see total touches
  // relative to the cap the agent will ever send.
  const sentCount = row.currentStep + (row.lastSentAt ? 1 : 0);
  const totalTouches = maxFollowUps + 1;
  const inboundCount = row.inboundCount ?? 0;
  return (
    <div className="group rounded-md border bg-background p-2.5 shadow-sm transition hover:shadow-md">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="mb-0.5 flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {sentCount}/{totalTouches} sent
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {row.contact.email}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {row.lastSentAt && (
            <span title="Last outbound">
              → {relTime(row.lastSentAt)}
            </span>
          )}
          {row.lastInboundAt && (
            <span
              title="Last reply from contact"
              className="text-emerald-700 dark:text-emerald-400"
            >
              ← {relTime(row.lastInboundAt)}
            </span>
          )}
          {inboundCount > 0 && (
            <span className="rounded bg-emerald-100 px-1 py-0 text-[9px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {inboundCount} repl{inboundCount === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
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
        {laneKey === 'COOLING_PERIOD' && row.cooldownUntil && (
          <p className="mt-2 rounded bg-sky-100 px-2 py-1 text-[10px] text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <Snowflake className="mr-1 inline size-2.5" />
            Resumes {new Date(row.cooldownUntil).toLocaleDateString()}
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
  const del = api.emailAgent.deleteEnrollment.useMutation({
    onSuccess: () => {
      toast.success('Enrollment deleted. You can now re-enrol the same email.');
      void utils.emailAgent.board.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const cool = api.emailAgent.coolCard.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Moved to Cooling — will auto-resume ${new Date(r.cooldownUntil).toLocaleDateString()}.`,
      );
      void utils.emailAgent.board.invalidate();
      void utils.emailAgent.thread.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const [hint, setHint] = useState('');
  const [coolDays, setCoolDays] = useState<number>(7);

  const name = data?.contact.firstName
    ? `${data.contact.firstName} ${data.contact.lastName ?? ''}`.trim()
    : (data?.contact.email ?? '');

  return (
    <Dialog open={!!enrollmentId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="truncate">{name}</span>
            <div className="flex items-center gap-2">
              {data && (
                <span className="text-xs font-normal text-muted-foreground">
                  {data.conversationStatus.replaceAll('_', ' ').toLowerCase()}
                </span>
              )}
              {enrollmentId && (
                <button
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete this enrollment and all its messages? "${name}" will be removed from the board and can be re-enrolled fresh.`,
                      )
                    )
                      return;
                    del.mutate({ enrollmentId });
                  }}
                  disabled={del.isPending}
                  className="rounded-md border border-red-300 px-2 py-0.5 text-[11px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                  title="Delete enrollment (cannot be undone)"
                >
                  Delete
                </button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="mb-4 flex items-baseline justify-between gap-4 text-xs">
              <span className="text-muted-foreground">
                {data.contact.email} · {data.messages.length} messages
                {data.cooldownUntil && data.conversationStatus === 'COOLING_PERIOD' && (
                  <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                    resumes {new Date(data.cooldownUntil).toLocaleDateString()}
                  </span>
                )}
              </span>
              {data.conversationStatus !== 'COOLING_PERIOD' &&
                data.conversationStatus !== 'INACTIVE' && (
                  <div className="flex items-center gap-1 rounded-md border bg-background p-1">
                    <Snowflake className="ml-1 size-3 text-sky-600" />
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={coolDays}
                      onChange={(e) =>
                        setCoolDays(
                          Math.max(
                            1,
                            Math.min(365, Number(e.target.value) || 1),
                          ),
                        )
                      }
                      className="w-12 rounded border bg-background px-1.5 py-0.5 text-xs"
                    />
                    <span className="text-[11px] text-muted-foreground">d</span>
                    <button
                      onClick={() =>
                        cool.mutate({
                          enrollmentId: enrollmentId!,
                          days: coolDays,
                        })
                      }
                      disabled={cool.isPending}
                      className="rounded px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                    >
                      Cool
                    </button>
                  </div>
                )}
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
                <div className="flex flex-wrap gap-2">
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
                  <div className="ml-auto flex items-center gap-1 rounded-md border bg-background p-1 text-sm">
                    <Snowflake className="ml-1 size-3.5 text-sky-600" />
                    <span className="text-xs text-muted-foreground">Cool for</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={coolDays}
                      onChange={(e) =>
                        setCoolDays(
                          Math.max(
                            1,
                            Math.min(365, Number(e.target.value) || 1),
                          ),
                        )
                      }
                      className="w-14 rounded border bg-background px-2 py-0.5 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">days</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        cool.mutate({
                          enrollmentId: enrollmentId!,
                          days: coolDays,
                        })
                      }
                      disabled={cool.isPending}
                    >
                      Cool
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
