'use client';

/**
 * WhatsApp Agent Kanban — mirror of email-agent kanban.
 *
 * NOTE: This is a near-copy of `email-agent/kanban/kanban.tsx` adapted
 * for the WhatsApp channel (phone-based test enrol, no CC block, phone
 * shown instead of email). A future refactor should extract a shared
 * `<AgentKanban>` primitive; for now we duplicate to preserve the
 * existing Email Agent behaviour without touching it.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Eye,
  MessageCircle,
  Plus,
  Search,
  Tag as TagIcon,
  Slash,
  Snowflake,
  Sparkles,
  Trash2,
  UserX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import {
  ActionsMenu,
  BoardRefreshButton,
} from '@/components/email-agent/kanban/kanban';

type LaneKey = 'ACTIVE_CONVERSATION' | 'REVIEW_RESPONSE' | 'COOLING_PERIOD' | 'INACTIVE';

const TAG_PRESETS: Array<{ label: string; classes: string }> = [
  { label: 'Hot', classes: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900' },
  { label: 'Interested', classes: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-900' },
  { label: 'Future Potential', classes: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900' },
  { label: 'Out of budget', classes: 'bg-yellow-100 text-yellow-900 border-yellow-300 dark:bg-yellow-950/50 dark:text-yellow-200 dark:border-yellow-900' },
  { label: 'Out of scope', classes: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900' },
  { label: 'Follow-up later', classes: 'bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-950/50 dark:text-pink-200 dark:border-pink-900' },
  { label: 'Not a fit', classes: 'bg-stone-200 text-stone-800 border-stone-300 dark:bg-stone-800/60 dark:text-stone-200 dark:border-stone-700' },
];
const CUSTOM_TAG_CLASSES = [
  'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-950/50 dark:text-fuchsia-200 dark:border-fuchsia-900',
  'bg-lime-100 text-lime-800 border-lime-300 dark:bg-lime-950/50 dark:text-lime-200 dark:border-lime-900',
  'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-900',
];
function tagClasses(tag: string): string {
  const preset = TAG_PRESETS.find((p) => p.label.toLowerCase() === tag.toLowerCase());
  if (preset) return preset.classes;
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return CUSTOM_TAG_CLASSES[h % CUSTOM_TAG_CLASSES.length]!;
}

const LANES: Array<{ key: LaneKey; label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = [
  { key: 'ACTIVE_CONVERSATION', label: 'Active Conversation', Icon: MessageCircle, color: 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20' },
  { key: 'REVIEW_RESPONSE', label: 'Review Response', Icon: Eye, color: 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20' },
  { key: 'COOLING_PERIOD', label: 'Cooling Period', Icon: Snowflake, color: 'border-sky-500/40 bg-sky-50/40 dark:bg-sky-950/20' },
  { key: 'INACTIVE', label: 'Inactive Conversation', Icon: Slash, color: 'border-zinc-400/40 bg-zinc-50/40 dark:bg-zinc-900/40' },
];

interface BoardRow {
  id: string;
  conversationStatus: LaneKey;
  status: string;
  currentStep: number;
  lastSentAt: Date | string | null;
  lastInboundAt: Date | string | null;
  cooldownUntil?: Date | string | null;
  suggestedReplyHint: string | null;
  tags?: string[];
  contact: { id: string; email: string | null; phone?: string | null; firstName: string | null; lastName: string | null };
  messages: Array<{ id: string; direction: 'INBOUND' | 'OUTBOUND'; subject: string; createdAt: Date | string; bodyText: string }>;
  inboundCount?: number;
}

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

export function WhatsappAgentKanban({
  agentId,
  agentName,
  slug,
}: {
  agentId: string;
  agentName: string;
  slug: string;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.whatsappAgent.board.useQuery(
    { id: agentId },
    { refetchInterval: 15_000 },
  );
  const move = api.whatsappAgent.moveCard.useMutation({
    onSuccess: () => void utils.whatsappAgent.board.invalidate({ id: agentId }),
    onError: (e) => toast.error(e.message),
  });

  const [openEnrollmentId, setOpenEnrollmentId] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Server-side search — see the note in email-agent kanban.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const searchQuery = api.whatsappAgent.boardSearch.useQuery(
    { id: agentId, q: debouncedSearch },
    { enabled: debouncedSearch.length > 0 },
  );
  const [filter, setFilter] = useState<'all' | 'with_replies' | 'awaiting_reply' | 'active_24h' | 'active_7d'>('all');
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());

  const allTagsOnBoard = (() => {
    const s = new Set<string>();
    for (const lane of LANES) {
      const rows = (data?.lanes[lane.key] ?? []) as BoardRow[];
      for (const r of rows) for (const t of r.tags ?? []) s.add(t);
    }
    return Array.from(s);
  })();

  const matches = (r: BoardRow): boolean => {
    // Search runs server-side (see boardSearch). Client-side only
    // applies the activity/tag chips over the currently loaded slice.
    if (filter === 'with_replies' && !(r.inboundCount && r.inboundCount > 0)) return false;
    if (filter === 'awaiting_reply' && !!r.lastInboundAt) return false;
    if (filter === 'active_24h' || filter === 'active_7d') {
      const cutoff = Date.now() - (filter === 'active_24h' ? 1 : 7) * 24 * 3600_000;
      const last = Math.max(
        r.lastSentAt ? new Date(r.lastSentAt).getTime() : 0,
        r.lastInboundAt ? new Date(r.lastInboundAt).getTime() : 0,
      );
      if (last < cutoff) return false;
    }
    if (tagFilter.size > 0) {
      const rowTagsLower = (r.tags ?? []).map((t) => t.toLowerCase());
      let hit = false;
      for (const t of tagFilter) if (rowTagsLower.includes(t.toLowerCase())) { hit = true; break; }
      if (!hit) return false;
    }
    return true;
  };

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href={`/t/${slug}/automation/whatsapp-agents`}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> All agents
          </Link>
          <h1 className="text-2xl font-semibold">{agentName}</h1>
          <p className="text-sm text-muted-foreground">Conversation board — drag or use the arrows to move a card.</p>
        </div>
        <div className="flex items-center gap-2">
          <BoardRefreshButton
            onRefresh={() => {
              void utils.whatsappAgent.board.invalidate({ id: agentId });
              void utils.whatsappAgent.thread.invalidate();
            }}
            isBusy={data ? false : isLoading}
          />
          <ActionsMenu
            slug={slug}
            agentId={agentId}
            channel="whatsapp"
            onOpenTest={() => setTestOpen(true)}
            onOpenBulk={() => setBulkOpen(true)}
          />
        </div>
      </header>

      <TestAgentDialog agentId={agentId} open={testOpen} onOpenChange={setTestOpen} />
      <BulkEnrollDialog agentId={agentId} open={bulkOpen} onOpenChange={setBulkOpen} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search across all lanes by name or phone…"
            className="w-full rounded-md border bg-background pl-8 pr-8 py-2 text-sm" />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
              title="Clear"><X className="size-3.5" /></button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {([['all', 'All'], ['with_replies', 'With replies'], ['awaiting_reply', 'Awaiting reply'],
            ['active_24h', 'Active · 24h'], ['active_7d', 'Active · 7d']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`rounded-full border px-2.5 py-1 transition ${filter === k
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted bg-background text-muted-foreground hover:bg-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {(TAG_PRESETS.length > 0 || allTagsOnBoard.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 inline-flex items-center gap-1 text-muted-foreground"><TagIcon className="size-3" /> Tags:</span>
          {(() => {
            const presetLabels = TAG_PRESETS.map((p) => p.label);
            const extras = allTagsOnBoard.filter((t) => !presetLabels.some((p) => p.toLowerCase() === t.toLowerCase()));
            return [...presetLabels, ...extras].map((label) => {
              const active = Array.from(tagFilter).some((t) => t.toLowerCase() === label.toLowerCase());
              return (
                <button key={label} onClick={() => setTagFilter((prev) => {
                  const next = new Set(prev);
                  if (active) { for (const t of prev) if (t.toLowerCase() === label.toLowerCase()) next.delete(t); }
                  else next.add(label);
                  return next;
                })}
                  className={`rounded-full border px-2 py-0.5 transition ${tagClasses(label)} ${
                    active ? 'ring-2 ring-offset-1 ring-primary/60' : 'opacity-70 hover:opacity-100'}`}>{label}</button>
              );
            });
          })()}
          {tagFilter.size > 0 && (
            <button onClick={() => setTagFilter(new Set())}
              className="ml-1 rounded-full border border-transparent px-2 py-0.5 text-muted-foreground hover:bg-muted">Clear</button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const searchActive = debouncedSearch.length > 0;
          const source = searchActive
            ? (searchQuery.data?.lanes[lane.key] ?? [])
            : (data?.lanes[lane.key] ?? []);
          const rawRows = source as BoardRow[];
          const rows = rawRows.filter(matches);
          const laneTotal = searchActive
            ? rawRows.length
            : (data?.laneCounts?.[lane.key] ?? rawRows.length);
          const loading = searchActive ? searchQuery.isLoading : isLoading;
          return (
            <section key={lane.key} className={`flex flex-col rounded-lg border ${lane.color}`}>
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <lane.Icon className="size-4" />
                <span className="text-sm font-semibold">{lane.label}</span>
                <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[11px] font-medium">
                  {loading ? '…' : rows.length === laneTotal ? rows.length : `${rows.length}/${laneTotal.toLocaleString()}`}
                </span>
              </header>
              <div className="max-h-[calc(100vh-260px)] min-h-[240px] flex-1 space-y-2 overflow-y-auto p-2">
                {loading ? (<><Skeleton className="h-20" /><Skeleton className="h-20" /></>)
                  : rows.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                      {searchActive ? 'No matches' : 'No cards'}
                    </p>
                  ) : rows.map((r) => (
                    <Card key={r.id} row={r} laneKey={lane.key} maxFollowUps={data?.maxFollowUps ?? 3}
                      onOpen={() => setOpenEnrollmentId(r.id)}
                      onMove={(to) => move.mutate({ enrollmentId: r.id, to })} />
                  ))}
              </div>
              {!searchActive && laneTotal > rows.length && (
                <div className="border-t px-3 py-1 text-center text-[10px] text-muted-foreground">
                  Showing {rows.length} of {laneTotal.toLocaleString()} · refine with search or filters
                </div>
              )}
            </section>
          );
        })}
      </div>

      <ThreadDialog enrollmentId={openEnrollmentId} onClose={() => setOpenEnrollmentId(null)}
        onMove={(to) => openEnrollmentId ? move.mutate({ enrollmentId: openEnrollmentId, to }) : undefined} />
    </div>
  );
}

function TestAgentDialog({
  agentId, open, onOpenChange,
}: {
  agentId: string; open: boolean; onOpenChange: (v: boolean) => void;
}): JSX.Element {
  const utils = api.useUtils();
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const enroll = api.whatsappAgent.enrollByPhone.useMutation({
    onSuccess: (r) => {
      toast.success(r.alreadyEnrolled
        ? 'Already enrolled — check the Active column.'
        : 'Enrolled — initial message fires within a minute.');
      void utils.whatsappAgent.board.invalidate({ id: agentId });
      onOpenChange(false); setPhone(''); setFirstName(''); setLastName('');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send a test to any phone</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            The recipient becomes a real enrollment on the board — you'll see the initial template send, any reply,
            and state transitions end-to-end. Use E.164 (e.g. +14155551234).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="First name (optional)" value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input placeholder="Last name (optional)" value={lastName} onChange={(e) => setLastName(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm" />
          </div>
          <input type="tel" placeholder="+14155551234" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => enroll.mutate({
              whatsappAgentId: agentId, phone,
              firstName: firstName || undefined, lastName: lastName || undefined,
            })} disabled={!phone.trim() || enroll.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              {enroll.isPending ? 'Enrolling…' : 'Send test'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BulkEnrollDialog({
  agentId, open, onOpenChange,
}: {
  agentId: string; open: boolean; onOpenChange: (v: boolean) => void;
}): JSX.Element {
  const utils = api.useUtils();
  const segments = api.whatsappAgent.segmentOptions.useQuery();
  const [segmentId, setSegmentId] = useState<string>('');
  const enroll = api.whatsappAgent.enrollFromSegment.useMutation({
    onSuccess: (r) => {
      toast.success(`Enrolled ${r.enrolled.toLocaleString()} · skipped ${r.skipped.toLocaleString()}.`);
      void utils.whatsappAgent.board.invalidate({ id: agentId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Enrol every subscribed contact in a segment</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Only contacts with a phone + SUBSCRIBED WhatsApp channel are enrolled. Initial template sends within the next minute.
          </p>
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Choose a segment…</option>
            {(segments.data ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => enroll.mutate({ whatsappAgentId: agentId, segmentId })}
              disabled={!segmentId || enroll.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700">
              {enroll.isPending ? 'Enrolling…' : 'Enrol'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Card({
  row, laneKey, maxFollowUps, onOpen, onMove,
}: {
  row: BoardRow;
  laneKey: LaneKey;
  maxFollowUps: number;
  onOpen: () => void;
  onMove: (to: LaneKey) => void;
}): JSX.Element {
  const name = row.contact.firstName
    ? `${row.contact.firstName} ${row.contact.lastName ?? ''}`.trim()
    : row.contact.phone ?? row.contact.email ?? '(no phone)';
  const last = row.messages[0];
  const idx = LANES.findIndex((l) => l.key === laneKey);
  const prev = LANES[idx - 1];
  const next = LANES[idx + 1];
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
        <p className="truncate text-[11px] text-muted-foreground">{row.contact.phone ?? row.contact.email}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {row.lastSentAt && <span title="Last outbound">→ {relTime(row.lastSentAt)}</span>}
          {row.lastInboundAt && (
            <span title="Last reply" className="text-emerald-700 dark:text-emerald-400">← {relTime(row.lastInboundAt)}</span>
          )}
          {inboundCount > 0 && (
            <span className="rounded bg-emerald-100 px-1 py-0 text-[9px] text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {inboundCount} repl{inboundCount === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
        {last && (
          <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{last.direction === 'INBOUND' ? '← reply · ' : '→ sent · '}</span>
            {last.bodyText.slice(0, 120)}
          </p>
        )}
        {(row.tags?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {row.tags!.map((t) => (
              <span key={t} className={`rounded-full border px-1.5 py-0 text-[9px] font-medium ${tagClasses(t)}`}>{t}</span>
            ))}
          </div>
        )}
        {row.suggestedReplyHint && laneKey === 'REVIEW_RESPONSE' && (
          <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-[10px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Sparkles className="mr-1 inline size-2.5" />Hint pending
          </p>
        )}
        {laneKey === 'COOLING_PERIOD' && row.cooldownUntil && (
          <p className="mt-2 rounded bg-sky-100 px-2 py-1 text-[10px] text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <Snowflake className="mr-1 inline size-2.5" />Resumes {new Date(row.cooldownUntil).toLocaleDateString()}
          </p>
        )}
      </button>
      <div className="mt-2 flex items-center justify-between border-t pt-1.5 opacity-0 transition group-hover:opacity-100">
        <button disabled={!prev} onClick={() => prev && onMove(prev.key)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          title={prev ? `Move to ${prev.label}` : 'First column'}>
          <ArrowLeft className="size-3" />
        </button>
        <span className="text-[10px] text-muted-foreground">
          {row.lastInboundAt ? <><Clock className="mr-0.5 inline size-2.5" />{new Date(row.lastInboundAt).toLocaleDateString()}</> : '—'}
        </span>
        <button disabled={!next} onClick={() => next && onMove(next.key)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          title={next ? `Move to ${next.label}` : 'Last column'}>
          <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  );
}

function ThreadDialog({
  enrollmentId, onClose, onMove,
}: {
  enrollmentId: string | null;
  onClose: () => void;
  onMove: (to: LaneKey) => void;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.whatsappAgent.thread.useQuery(
    { enrollmentId: enrollmentId ?? '' },
    { enabled: !!enrollmentId },
  );
  const submitHint = api.whatsappAgent.submitSuggestedReply.useMutation({
    onSuccess: () => {
      toast.success('Hint submitted — agent will draft within a minute.');
      void utils.whatsappAgent.board.invalidate();
      void utils.whatsappAgent.thread.invalidate();
      setHint(''); onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = api.whatsappAgent.deleteEnrollment.useMutation({
    onSuccess: () => {
      toast.success('Enrollment deleted. You can now re-enrol.');
      void utils.whatsappAgent.board.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const setTagsM = api.whatsappAgent.setTags.useMutation({
    onSuccess: () => {
      void utils.whatsappAgent.board.invalidate();
      void utils.whatsappAgent.thread.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cool = api.whatsappAgent.coolCard.useMutation({
    onSuccess: (r) => {
      toast.success(`Moved to Cooling — resumes ${new Date(r.cooldownUntil).toLocaleDateString()}.`);
      void utils.whatsappAgent.board.invalidate();
      void utils.whatsappAgent.thread.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const [hint, setHint] = useState('');
  const [coolDays, setCoolDays] = useState<number>(7);

  const name = data?.contact.firstName
    ? `${data.contact.firstName} ${data.contact.lastName ?? ''}`.trim()
    : (data?.contact.phone ?? data?.contact.email ?? '');

  return (
    <Dialog open={!!enrollmentId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="truncate">{name}</span>
            <div className="flex items-center gap-1">
              {data && (
                <span className="mr-2 text-xs font-normal text-muted-foreground">
                  {data.conversationStatus.replaceAll('_', ' ').toLowerCase()}
                </span>
              )}
              {enrollmentId && data && data.conversationStatus !== 'INACTIVE' && (
                <button title="Mark inactive" onClick={() => onMove('INACTIVE')}
                  className="rounded-md p-1.5 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40">
                  <UserX className="size-4" />
                </button>
              )}
              {enrollmentId && (
                <button title="Delete enrollment" disabled={del.isPending}
                  onClick={() => {
                    if (!window.confirm(`Delete enrollment for "${name}"? All messages will be removed and the contact can be re-enrolled.`)) return;
                    del.mutate({ enrollmentId });
                  }}
                  className="rounded-md p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/40">
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (<Skeleton className="h-96" />) : (
          <>
            <div className="mb-4 flex items-baseline justify-between gap-4 text-xs">
              <span className="text-muted-foreground">
                {data.contact.phone ?? data.contact.email} · {data.messages.length} messages
              </span>
              {data.conversationStatus !== 'COOLING_PERIOD' && data.conversationStatus !== 'INACTIVE' && (
                <div className="flex items-center gap-1 rounded-md border bg-background p-1">
                  <Snowflake className="ml-1 size-3 text-sky-600" />
                  <input type="number" min={1} max={365} value={coolDays}
                    onChange={(e) => setCoolDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                    className="w-12 rounded border bg-background px-1.5 py-0.5 text-xs" />
                  <span className="text-[11px] text-muted-foreground">d</span>
                  <button onClick={() => cool.mutate({ enrollmentId: enrollmentId!, days: coolDays })}
                    disabled={cool.isPending}
                    className="rounded px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40">Cool</button>
                </div>
              )}
            </div>

            <div className="mb-4">
              <TagEditor current={(data as { tags?: string[] }).tags ?? []} pending={setTagsM.isPending}
                onChange={(tags) => setTagsM.mutate({ enrollmentId: enrollmentId!, tags })} />
            </div>

            <div className="space-y-3">
              {data.messages.map((m) => (
                <div key={m.id} className={`rounded-lg border p-3 ${m.direction === 'INBOUND'
                  ? 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20' : 'bg-muted/30'}`}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold">
                      {m.direction === 'INBOUND'
                        ? `← ${data.contact.phone ?? data.contact.email}`
                        : `→ ${data.emailAgent.fromName} <${data.emailAgent.fromEmail}>`}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(m.sentAt ?? m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-foreground/90 dark:prose-invert">
                    {m.bodyText}
                  </div>
                </div>
              ))}
            </div>

            {data.conversationStatus === 'REVIEW_RESPONSE' && (
              <div className="mt-6 space-y-2 rounded-lg border border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/20">
                <p className="text-sm font-semibold">Suggest a reply</p>
                <p className="text-xs text-muted-foreground">
                  Tell the agent what to include. It'll weave your hint into the next message and move the card back to Active.
                </p>
                <textarea rows={4} value={hint} onChange={(e) => setHint(e.target.value)}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  placeholder="e.g. Mention the demo call slots available next week." />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => submitHint.mutate({ enrollmentId: enrollmentId!, hint: hint.trim() })}
                    disabled={!hint.trim() || submitHint.isPending}
                    className="bg-emerald-600 text-white hover:bg-emerald-700">Submit hint & resume</Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TagEditor({
  current, pending, onChange,
}: {
  current: string[];
  pending: boolean;
  onChange: (tags: string[]) => void;
}): JSX.Element {
  const [custom, setCustom] = useState('');
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const toggle = (tag: string) => {
    if (current.some((t) => eq(t, tag))) onChange(current.filter((t) => !eq(t, tag)));
    else {
      if (current.length >= 8) return toast.error('Max 8 tags.');
      onChange([...current, tag]);
    }
  };
  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (current.some((t) => eq(t, v))) { setCustom(''); return; }
    if (current.length >= 8) return toast.error('Max 8 tags.');
    onChange([...current, v]);
    setCustom('');
  };
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
        <TagIcon className="size-3.5" /> Tags
        {pending && <span className="text-[10px] font-normal text-muted-foreground">saving…</span>}
      </div>
      {current.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {current.map((t) => (
            <span key={t} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tagClasses(t)}`}>
              {t}
              <button onClick={() => onChange(current.filter((x) => x !== t))}
                className="rounded-full opacity-70 hover:opacity-100"><X className="size-2.5" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {TAG_PRESETS.map((p) => {
          const active = current.some((t) => eq(t, p.label));
          return (
            <button key={p.label} onClick={() => toggle(p.label)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${p.classes} ${
                active ? 'ring-2 ring-primary/60' : 'opacity-70 hover:opacity-100'}`}>
              {active ? '✓ ' : '+ '}{p.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1">
        <input value={custom} onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder="Add custom tag…"
          className="flex-1 rounded-md border bg-background px-2 py-1 text-xs" maxLength={40} />
        <button onClick={addCustom} disabled={!custom.trim()}
          className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">
          <Plus className="size-3" />
        </button>
      </div>
    </div>
  );
}
