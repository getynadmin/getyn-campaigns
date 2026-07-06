'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronLeft,
  Loader2,
  Pause,
  Plus,
  Play,
  RefreshCw,
  Save,
  Trash2,
  X,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/**
 * Phase 8 M4 — 5-step Email Agent wizard.
 *
 * Handles both create (agentId=null) and edit (agentId set). Every
 * step is a single form section; navigation is next/back not
 * committed state — the user hits "Save" on step 5 to persist.
 *
 * Knowledge sources are a special case: they persist immediately on
 * add (the row is durable and the M6 ingest worker starts extracting
 * right away). Removing a source deletes the row.
 */

const STEPS = [
  { key: 'goal', label: 'Goal + Voice' },
  { key: 'knowledge', label: 'Knowledge base' },
  { key: 'audience', label: 'Audience' },
  { key: 'sender', label: 'Sender details' },
  { key: 'review', label: 'Review' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

type Tone = 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL' | 'PLAYFUL' | 'AUTHORITATIVE' | 'EMPATHETIC';

interface FormState {
  name: string;
  goal: string;
  tone: Tone;
  systemInstructions: string;
  signature: string;
  targetSegmentId: string | null;
  autoEnrollNewContacts: boolean;
  initialDelayHours: number;
  followUpDays: number[];
  maxFollowUps: number;
  stopOnReply: boolean;
  fromName: string;
  fromEmail: string;
}

const EMPTY_STATE: FormState = {
  name: '',
  goal: '',
  tone: 'PROFESSIONAL',
  systemInstructions: '',
  signature: '',
  targetSegmentId: null,
  autoEnrollNewContacts: false,
  initialDelayHours: 0,
  followUpDays: [3, 7, 14],
  maxFollowUps: 3,
  stopOnReply: true,
  fromName: '',
  fromEmail: '',
};

export function EmailAgentWizard({
  slug,
  agentId,
}: {
  slug: string;
  agentId: string | null;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const isEdit = agentId !== null;
  const [step, setStep] = useState<StepKey>('goal');
  const [state, setState] = useState<FormState>(EMPTY_STATE);
  const [segmentConfirmOpen, setSegmentConfirmOpen] = useState(false);

  const agentQuery = api.emailAgent.get.useQuery(
    { id: agentId ?? '' },
    { enabled: isEdit },
  );
  const fromOptions = api.emailAgent.fromEmailOptions.useQuery();
  const segmentOptions = api.emailAgent.segmentOptions.useQuery();

  // Hydrate once when the query resolves in edit mode.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!isEdit || hydrated || !agentQuery.data) return;
    const a = agentQuery.data;
    const schedule = (a.outboundSchedule ?? {}) as Partial<FormState>;
    setState({
      name: a.name,
      goal: a.goal,
      tone: a.tone as Tone,
      systemInstructions: a.systemInstructions,
      signature: a.signature,
      targetSegmentId: a.targetSegmentId,
      autoEnrollNewContacts: a.autoEnrollNewContacts,
      initialDelayHours: Number(schedule.initialDelayHours ?? 0),
      followUpDays: Array.isArray(schedule.followUpDays)
        ? (schedule.followUpDays as number[])
        : [3, 7, 14],
      maxFollowUps: Number(schedule.maxFollowUps ?? 3),
      stopOnReply: Boolean(schedule.stopOnReply ?? true),
      fromName: a.fromName,
      fromEmail: a.fromEmail,
    });
    setHydrated(true);
  }, [isEdit, hydrated, agentQuery.data]);

  const upsert = api.emailAgent.upsert.useMutation({
    onSuccess: (data) => {
      void utils.emailAgent.list.invalidate();
      if (!isEdit) {
        toast.success('Agent saved as draft.');
        router.replace(`/t/${slug}/automation/agents/${data.id}`);
      } else {
        toast.success('Saved.');
        void utils.emailAgent.get.invalidate({ id: agentId! });
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const activate = api.emailAgent.activate.useMutation({
    onSuccess: () => {
      toast.success('Agent is live.');
      void utils.emailAgent.get.invalidate({ id: agentId! });
      void utils.emailAgent.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const pause = api.emailAgent.pause.useMutation({
    onSuccess: () => {
      toast.success('Agent paused.');
      void utils.emailAgent.get.invalidate({ id: agentId! });
      void utils.emailAgent.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = api.emailAgent.delete.useMutation({
    onSuccess: () => {
      toast.success('Agent deleted.');
      void utils.emailAgent.list.invalidate();
      router.push(`/t/${slug}/automation/agents`);
    },
    onError: (err) => toast.error(err.message),
  });

  const currentStatus = isEdit ? (agentQuery.data?.status ?? 'DRAFT') : 'DRAFT';

  const segmentChanged =
    isEdit &&
    agentQuery.data &&
    agentQuery.data.targetSegmentId !== state.targetSegmentId;

  function save(): void {
    // Guard segment change on ACTIVE agents.
    if (
      currentStatus === 'ACTIVE' &&
      segmentChanged &&
      !segmentConfirmOpen
    ) {
      setSegmentConfirmOpen(true);
      return;
    }
    upsert.mutate({
      id: agentId ?? undefined,
      name: state.name.trim(),
      goal: state.goal.trim(),
      tone: state.tone,
      systemInstructions: state.systemInstructions,
      outboundSchedule: {
        initialDelayHours: state.initialDelayHours,
        followUpDays: state.followUpDays,
        maxFollowUps: state.maxFollowUps,
        stopOnReply: state.stopOnReply,
      },
      targetSegmentId: state.targetSegmentId,
      autoEnrollNewContacts: state.autoEnrollNewContacts,
      signature: state.signature,
      fromName: state.fromName.trim(),
      fromEmail: state.fromEmail.trim().toLowerCase(),
    });
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  if (isEdit && !hydrated) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={`/t/${slug}/automation/agents`}>
              <ArrowLeft className="mr-1 size-4" /> Back to agents
            </Link>
          </Button>
          <h1 className="mt-2 flex items-center gap-2 font-display text-xl font-semibold">
            <Bot className="size-5" />
            {isEdit ? state.name || 'Untitled agent' : 'New email agent'}
            <StatusBadge status={currentStatus} />
          </h1>
        </div>
        {isEdit && (
          <div className="flex items-center gap-2">
            {currentStatus === 'ACTIVE' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => pause.mutate({ id: agentId! })}
                disabled={pause.isPending}
              >
                <Pause className="mr-1 size-4" /> Pause
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => activate.mutate({ id: agentId! })}
                disabled={activate.isPending}
              >
                <Play className="mr-1 size-4" /> Activate
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm('Delete this agent?')) remove.mutate({ id: agentId! });
              }}
              className="text-rose-700"
            >
              <Trash2 className="mr-1 size-4" /> Delete
            </Button>
          </div>
        )}
      </header>

      {/* Stepper */}
      <ol className="grid grid-cols-5 gap-1 rounded-md border bg-card p-1">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              onClick={() => setStep(s.key)}
              className={cn(
                'w-full rounded px-2 py-1.5 text-center text-xs font-medium transition-colors',
                s.key === step
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              <span className="mr-1 opacity-60">{i + 1}.</span> {s.label}
            </button>
          </li>
        ))}
      </ol>

      {/* Step body */}
      <div className="rounded-lg border bg-card p-5">
        {step === 'goal' && (
          <GoalStep state={state} setState={setState} />
        )}
        {step === 'knowledge' && (
          <KnowledgeStep agentId={agentId} isEdit={isEdit} />
        )}
        {step === 'audience' && (
          <AudienceStep
            state={state}
            setState={setState}
            segments={segmentOptions.data ?? []}
          />
        )}
        {step === 'sender' && (
          <SenderStep
            state={state}
            setState={setState}
            fromOptions={fromOptions.data ?? []}
          />
        )}
        {step === 'review' && (
          <ReviewStep
            state={state}
            segments={segmentOptions.data ?? []}
            isEdit={isEdit}
          />
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={currentStepIndex === 0}
          onClick={() => {
            const prev = STEPS[currentStepIndex - 1];
            if (prev) setStep(prev.key);
          }}
        >
          <ChevronLeft className="mr-1 size-4" /> Back
        </Button>
        {step !== 'review' ? (
          <Button
            onClick={() => {
              const next = STEPS[currentStepIndex + 1];
              if (next) setStep(next.key);
            }}
          >
            Continue <ArrowRight className="ml-1 size-4" />
          </Button>
        ) : (
          <Button onClick={save} disabled={upsert.isPending}>
            {upsert.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            <Save className="mr-1 size-4" />
            {isEdit ? 'Save changes' : 'Save as draft'}
          </Button>
        )}
      </div>

      {/* Segment-change confirmation */}
      <Dialog open={segmentConfirmOpen} onOpenChange={setSegmentConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change target segment?</DialogTitle>
            <DialogDescription>
              This agent is active. Existing enrollments continue running until
              they finish or reply — they won&apos;t re-target the new segment.
              New enrollments will use the new segment going forward. Pause the
              agent if you want a clean switchover.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSegmentConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setSegmentConfirmOpen(false);
                // Server currently refuses segment change on ACTIVE
                // agents. Guide the user to pause first.
                toast.error(
                  'Pause the agent before changing its segment. Open the top-right menu and click Pause.',
                );
              }}
            >
              Understood
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------
// Step 1 — Goal + Voice
// -----------------------------------------------------------------

function GoalStep({
  state,
  setState,
}: {
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="Agent name" hint="Shown in your dashboard.">
        <Input
          value={state.name}
          onChange={(e) => setState({ ...state, name: e.target.value })}
          placeholder="Sales SDR"
          maxLength={120}
        />
      </Field>
      <Field
        label="Goal"
        hint="Plain-English description of what this agent is trying to do."
      >
        <textarea
          className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
          value={state.goal}
          onChange={(e) => setState({ ...state, goal: e.target.value })}
          placeholder="Introduce Getyn Campaigns to marketing leaders at Series-B startups, get on a 20-min call."
          maxLength={4000}
        />
      </Field>
      <Field label="Tone">
        <Select
          value={state.tone}
          onValueChange={(v) => setState({ ...state, tone: v as Tone })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PROFESSIONAL">Professional</SelectItem>
            <SelectItem value="FRIENDLY">Friendly</SelectItem>
            <SelectItem value="CASUAL">Casual</SelectItem>
            <SelectItem value="PLAYFUL">Playful</SelectItem>
            <SelectItem value="AUTHORITATIVE">Authoritative</SelectItem>
            <SelectItem value="EMPATHETIC">Empathetic</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="System instructions"
        hint="Long-form guidance the agent follows on every message. Examples: 'Always sign off with Best, Sarah', 'Never offer discounts', 'Refer pricing questions to getyn.com/pricing'."
      >
        <textarea
          className="min-h-48 w-full rounded-md border bg-background p-2 font-mono text-xs"
          value={state.systemInstructions}
          onChange={(e) =>
            setState({ ...state, systemInstructions: e.target.value })
          }
          placeholder="Never offer discounts unless the customer mentions budget concerns twice.&#10;Sign off with 'Best, Sarah from Getyn'.&#10;If asked about pricing, refer to getyn.com/pricing."
          maxLength={20000}
        />
      </Field>
      <Field label="Signature" hint="Appended to every outbound message.">
        <textarea
          className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
          value={state.signature}
          onChange={(e) => setState({ ...state, signature: e.target.value })}
          placeholder="—&#10;Sarah at Getyn&#10;getyn.com"
          maxLength={2000}
        />
      </Field>
    </div>
  );
}

// -----------------------------------------------------------------
// Step 2 — Knowledge base
// -----------------------------------------------------------------

function KnowledgeStep({
  agentId,
  isEdit,
}: {
  agentId: string | null;
  isEdit: boolean;
}): JSX.Element {
  if (!isEdit || !agentId) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Save the agent first (finish steps 1–5), then come back here to add
        knowledge sources.
      </div>
    );
  }
  return <KnowledgeStepInner agentId={agentId} />;
}

function KnowledgeStepInner({ agentId }: { agentId: string }): JSX.Element {
  const { data, isLoading } = api.emailAgent.get.useQuery(
    { id: agentId },
    // Poll while any source is still extracting so the summary lights up
    // without a manual refresh.
    { refetchInterval: 5_000 },
  );
  const utils = api.useUtils();
  const [kind, setKind] = useState<'URL' | 'TEXT'>('URL');
  const [url, setUrl] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');

  const add = api.emailAgent.addKnowledgeSource.useMutation({
    onSuccess: () => {
      toast.success('Knowledge source added.');
      void utils.emailAgent.get.invalidate({ id: agentId });
      setUrl('');
      setTextTitle('');
      setTextBody('');
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = api.emailAgent.removeKnowledgeSource.useMutation({
    onSuccess: () => {
      toast.success('Removed.');
      void utils.emailAgent.get.invalidate({ id: agentId });
    },
    onError: (err) => toast.error(err.message),
  });

  const refresh = api.emailAgent.refreshKnowledgeSource.useMutation({
    onSuccess: () => {
      toast.success('Re-extracting…');
      void utils.emailAgent.get.invalidate({ id: agentId });
    },
    onError: (err) => toast.error(err.message),
  });

  function submit(): void {
    if (kind === 'URL') {
      add.mutate({
        emailAgentId: agentId,
        source: { kind: 'URL', sourceUrl: url.trim() },
      });
    } else {
      add.mutate({
        emailAgentId: agentId,
        source: { kind: 'TEXT', rawTitle: textTitle.trim(), text: textBody.trim() },
      });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Knowledge sources</p>
        <p className="text-xs text-muted-foreground">
          The agent draws on these to write replies. Add URLs (product pages,
          docs) or paste raw text (FAQs, positioning docs). File uploads land
          when we wire the ingest worker.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="divide-y rounded-md border">
          {(data?.knowledgeSources ?? []).length === 0 ? (
            <li className="p-6 text-center text-xs text-muted-foreground">
              No sources yet. Add one below.
            </li>
          ) : (
            data?.knowledgeSources.map((s) => {
              const meta = (s.metadata ?? {}) as {
                ingestPending?: boolean;
                ingestError?: string;
              };
              const pending = Boolean(meta.ingestPending);
              return (
                <li key={s.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {s.kind}
                      </span>
                      <span className="truncate text-sm font-medium">{s.rawTitle}</span>
                      {pending && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                          <Loader2 className="size-3 animate-spin" />
                          Extracting…
                        </span>
                      )}
                      {meta.ingestError && (
                        <span
                          className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-900 dark:bg-rose-950 dark:text-rose-200"
                          title={meta.ingestError}
                        >
                          Ingest failed
                        </span>
                      )}
                    </div>
                    {s.sourceUrl && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {s.sourceUrl}
                      </p>
                    )}
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {s.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Re-fetch and re-summarize"
                      disabled={pending || refresh.isPending}
                      onClick={() => refresh.mutate({ id: s.id })}
                    >
                      <RefreshCw className={cn('size-4', pending && 'animate-spin')} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate({ id: s.id })}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}

      <div className="rounded-md border bg-muted/20 p-3">
        <div className="mb-2 flex gap-2">
          <button
            onClick={() => setKind('URL')}
            className={cn(
              'rounded-md border px-2 py-1 text-xs',
              kind === 'URL' && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            URL
          </button>
          <button
            onClick={() => setKind('TEXT')}
            className={cn(
              'rounded-md border px-2 py-1 text-xs',
              kind === 'TEXT' && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            Text
          </button>
          <button
            disabled
            className="cursor-not-allowed rounded-md border px-2 py-1 text-xs opacity-50"
            title="File uploads land in M6"
          >
            File (soon)
          </button>
        </div>
        {kind === 'URL' ? (
          <div className="space-y-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://getyn.com/pricing"
            />
            <Button size="sm" onClick={submit} disabled={add.isPending || !url.trim()}>
              <Plus className="mr-1 size-3.5" /> Add URL
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              placeholder="Title (e.g. Pricing FAQ)"
              maxLength={200}
            />
            <textarea
              className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
              placeholder="Paste raw text — FAQs, positioning, competitor comparisons…"
              maxLength={50_000}
            />
            <Button
              size="sm"
              onClick={submit}
              disabled={add.isPending || !textTitle.trim() || !textBody.trim()}
            >
              <Plus className="mr-1 size-3.5" /> Add text
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Step 3 — Audience
// -----------------------------------------------------------------

function AudienceStep({
  state,
  setState,
  segments,
}: {
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
  segments: { id: string; name: string; cachedCount: number | null }[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Field
        label="Target segment"
        hint="Contacts in this segment become eligible for enrollment."
      >
        <Select
          value={state.targetSegmentId ?? 'none'}
          onValueChange={(v) =>
            setState({ ...state, targetSegmentId: v === 'none' ? null : v })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a segment…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No segment (manual enrollment only)</SelectItem>
            {segments.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                {s.cachedCount !== null && ` (${s.cachedCount.toLocaleString()})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.autoEnrollNewContacts}
          onChange={(e) =>
            setState({ ...state, autoEnrollNewContacts: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Auto-enroll new matching contacts</span>
          <p className="text-xs text-muted-foreground">
            As contacts are added or updated to match the segment, the agent
            enrolls them automatically. Off = manual enrollment only.
          </p>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Initial delay (hours)"
          hint="Wait this long after enrollment before sending the first email."
        >
          <Input
            type="number"
            min={0}
            max={336}
            value={state.initialDelayHours}
            onChange={(e) =>
              setState({
                ...state,
                initialDelayHours: Math.max(0, Number(e.target.value)),
              })
            }
          />
        </Field>
        <Field label="Max follow-ups">
          <Input
            type="number"
            min={0}
            max={10}
            value={state.maxFollowUps}
            onChange={(e) =>
              setState({
                ...state,
                maxFollowUps: Math.max(0, Math.min(10, Number(e.target.value))),
              })
            }
          />
        </Field>
      </div>
      <Field
        label="Follow-up schedule (days)"
        hint="Comma-separated day offsets from initial send. Example: 3,7,14"
      >
        <Input
          value={state.followUpDays.join(', ')}
          onChange={(e) =>
            setState({
              ...state,
              followUpDays: e.target.value
                .split(',')
                .map((s) => Number.parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n) && n > 0),
            })
          }
          placeholder="3, 7, 14"
        />
      </Field>
      <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={state.stopOnReply}
          onChange={(e) =>
            setState({ ...state, stopOnReply: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Stop follow-ups on reply</span>
          <p className="text-xs text-muted-foreground">
            When the contact replies, pause the sequence and surface the draft
            in the approval inbox. Recommended on.
          </p>
        </span>
      </label>
    </div>
  );
}

// -----------------------------------------------------------------
// Step 4 — Sender details
// -----------------------------------------------------------------

function SenderStep({
  state,
  setState,
  fromOptions,
}: {
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
  fromOptions: string[];
}): JSX.Element {
  const localPart = state.fromEmail.split('@')[0] ?? '';
  const domainPart = state.fromEmail.includes('@')
    ? state.fromEmail.split('@')[1]!
    : (fromOptions[0] ?? '');
  return (
    <div className="space-y-4">
      <Field label="From name">
        <Input
          value={state.fromName}
          onChange={(e) => setState({ ...state, fromName: e.target.value })}
          placeholder="Sarah at Getyn"
          maxLength={120}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <Field label="From email — local part">
          <Input
            value={localPart}
            onChange={(e) =>
              setState({
                ...state,
                fromEmail: `${e.target.value}@${domainPart}`,
              })
            }
            placeholder="sarah"
          />
        </Field>
        <Field label="Sending domain">
          <Select
            value={domainPart}
            onValueChange={(v) =>
              setState({ ...state, fromEmail: `${localPart}@${v}` })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a domain…" />
            </SelectTrigger>
            <SelectContent>
              {fromOptions.length === 0 ? (
                <SelectItem value="none" disabled>
                  No verified domains — add one under Settings.
                </SelectItem>
              ) : (
                fromOptions.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span className="font-medium">Reply-To:</span> replies to this agent
        route back through <code>reply.getyn.com</code> so they land in the
        approval inbox. You don&apos;t need to configure anything here.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------
// Step 5 — Review
// -----------------------------------------------------------------

function ReviewStep({
  state,
  segments,
  isEdit,
}: {
  state: FormState;
  segments: { id: string; name: string; cachedCount: number | null }[];
  isEdit: boolean;
}): JSX.Element {
  const segment = state.targetSegmentId
    ? segments.find((s) => s.id === state.targetSegmentId)
    : null;
  const items = useMemo(
    () => [
      ['Name', state.name || '(unnamed)'],
      ['Goal', state.goal || '(none)'],
      ['Tone', state.tone.toLowerCase()],
      ['Target segment', segment?.name ?? '(manual enrollment)'],
      ['Auto-enroll', state.autoEnrollNewContacts ? 'Yes' : 'No'],
      [
        'Schedule',
        `Send after ${state.initialDelayHours}h, then follow up on days ${state.followUpDays.join(', ') || '(none)'} (max ${state.maxFollowUps})`,
      ],
      ['Stop on reply', state.stopOnReply ? 'Yes' : 'No'],
      ['Sender', `${state.fromName} <${state.fromEmail}>`],
    ],
    [state, segment],
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Review</p>
        <p className="text-xs text-muted-foreground">
          Save the agent as a draft. Add knowledge sources on step 2 (Knowledge
          base), then flip Activate from the header to start enrolling contacts.
        </p>
      </div>
      <dl className="divide-y rounded-md border">
        {items.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 p-3">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              {k}
            </dt>
            <dd className="text-sm">{v}</dd>
          </div>
        ))}
      </dl>
      {!isEdit && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          After you save, we&apos;ll route you to the agent&apos;s edit page so
          you can add knowledge sources (required before activation).
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------
// Shared UI
// -----------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    ACTIVE:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAUSED:
      'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ARCHIVED: 'bg-muted text-muted-foreground opacity-70',
  };
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
        map[status],
      )}
    >
      {status}
    </span>
  );
}
