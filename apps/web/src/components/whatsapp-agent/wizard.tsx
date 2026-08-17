'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, ChevronLeft, Loader2, MessageSquare,
  Pause, Play, Save, Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'goal', label: 'Persona + Goal' },
  { key: 'knowledge', label: 'Knowledge URLs' },
  { key: 'audience', label: 'Schedule' },
  { key: 'sender', label: 'Sender + Template' },
  { key: 'review', label: 'Review' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

interface FormState {
  name: string;
  persona: string;
  goal: string;
  signature: string;
  knowledgeUrls: string[];
  phoneNumberId: string;
  initialTemplateId: string | null;
  followUpDays: number[];
  maxFollowUps: number;
  stopKeywords: string;
  coolingPeriodDays: number;
}

// Prefill templates for /automation/whatsapp-agents/new?template=<slug>.
// SkillCertified — old-customer re-engagement over WhatsApp. Persona
// + goal + signature + schedule + stop keywords match the Email Agent
// SkillCertified template so the operator gets a consistent brand
// voice across channels. Approved WA template picking still lives in
// the Sender step — Meta requires an approved template for the
// initial outbound, so we can't prefill that.
const TEMPLATES: Record<string, Partial<FormState>> = {
  skillcertified: {
    name: 'SkillCertified — WhatsApp Concierge',
    persona:
      'You are a warm, professional SkillCertified concierge on WhatsApp. Keep messages short — WhatsApp reads more like SMS than email. Be helpful, never pushy, and never marketing-y.',
    goal:
      'Re-engage past SkillCertified inquiries who never confirmed a course. We do not know which specific course each contact previously asked about, so the opening (via the approved template) is a warm check-in that spans our top tracks — Microsoft, SAP, VMware, Cisco, Cybersecurity, Cloud, AI, Business & Finance — and surfaces 2026 in-demand certifications. Goal: reopen the conversation and learn what they need this year.',
    signature: '— The SkillCertified Team',
    knowledgeUrls: [
      'https://www.skillcertified.com',
      'https://www.skillcertified.com/batches',
      'https://www.skillcertified.com/course/catalog',
    ],
    followUpDays: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40],
    maxFollowUps: 10,
    stopKeywords:
      'stop,unsubscribe,do not message me,remove me,not interested,leave me alone',
    coolingPeriodDays: 45,
  },
};

const EMPTY: FormState = {
  name: '',
  persona: '',
  goal: '',
  signature: '',
  knowledgeUrls: [],
  phoneNumberId: '',
  initialTemplateId: null,
  followUpDays: [3, 7, 14],
  maxFollowUps: 3,
  stopKeywords: 'stop,unsubscribe,do not message me,remove me',
  coolingPeriodDays: 30,
};

export function WhatsappAgentWizard({
  slug, agentId,
}: {
  slug: string;
  agentId: string | null;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const isEdit = agentId !== null;
  const [step, setStep] = useState<StepKey>('goal');
  const [state, setState] = useState<FormState>(() => {
    // Prefill from ?template=<slug> so operators don't hand-copy the
    // SkillCertified boilerplate every time.
    if (typeof window === 'undefined') return EMPTY;
    const t = new URLSearchParams(window.location.search).get('template');
    const tpl = t ? TEMPLATES[t] : null;
    return tpl ? { ...EMPTY, ...tpl } : EMPTY;
  });

  const agentQuery = api.whatsappAgent.get.useQuery({ id: agentId ?? '' }, { enabled: isEdit });
  const phoneOptions = api.whatsappAgent.phoneOptions.useQuery();
  const templateOptions = api.whatsappAgent.templateOptions.useQuery();

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!isEdit || hydrated || !agentQuery.data) return;
    const a = agentQuery.data as unknown as {
      name: string; persona: string; goal: string; signature: string | null;
      knowledgeUrls: string[]; phoneNumberId: string; initialTemplateId: string | null;
      outboundSchedule: { followUpDays?: number[]; maxFollowUps?: number };
      stopKeywords: string; coolingPeriodDays: number;
    };
    setState({
      name: a.name,
      persona: a.persona,
      goal: a.goal,
      signature: a.signature ?? '',
      knowledgeUrls: a.knowledgeUrls ?? [],
      phoneNumberId: a.phoneNumberId,
      initialTemplateId: a.initialTemplateId,
      followUpDays: Array.isArray(a.outboundSchedule?.followUpDays) ? a.outboundSchedule.followUpDays : [3, 7, 14],
      maxFollowUps: Number(a.outboundSchedule?.maxFollowUps ?? 3),
      stopKeywords: a.stopKeywords,
      coolingPeriodDays: Number(a.coolingPeriodDays ?? 30),
    });
    setHydrated(true);
  }, [isEdit, hydrated, agentQuery.data]);

  const upsert = api.whatsappAgent.upsert.useMutation({
    onSuccess: (data) => {
      void utils.whatsappAgent.list.invalidate();
      if (!isEdit) {
        toast.success('Agent saved as draft.');
        router.replace(`/t/${slug}/automation/whatsapp-agents/${data.id}`);
      } else {
        toast.success('Saved.');
        void utils.whatsappAgent.get.invalidate({ id: agentId! });
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const activate = api.whatsappAgent.activate.useMutation({
    onSuccess: () => { toast.success('Agent is live.'); void utils.whatsappAgent.get.invalidate({ id: agentId! }); void utils.whatsappAgent.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const pause = api.whatsappAgent.pause.useMutation({
    onSuccess: () => { toast.success('Agent paused.'); void utils.whatsappAgent.get.invalidate({ id: agentId! }); void utils.whatsappAgent.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const remove = api.whatsappAgent.delete.useMutation({
    onSuccess: () => { toast.success('Agent deleted.'); void utils.whatsappAgent.list.invalidate(); router.push(`/t/${slug}/automation/whatsapp-agents`); },
    onError: (err) => toast.error(err.message),
  });

  const currentStatus = isEdit ? (agentQuery.data?.status ?? 'DRAFT') : 'DRAFT';

  function save(): void {
    upsert.mutate({
      id: agentId ?? undefined,
      name: state.name.trim(),
      persona: state.persona.trim(),
      goal: state.goal.trim(),
      knowledgeUrls: state.knowledgeUrls,
      phoneNumberId: state.phoneNumberId,
      initialTemplateId: state.initialTemplateId,
      signature: state.signature,
      outboundSchedule: { followUpDays: state.followUpDays, maxFollowUps: state.maxFollowUps },
      stopKeywords: state.stopKeywords.trim(),
      coolingPeriodDays: state.coolingPeriodDays,
    });
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  if (isEdit && !hydrated) {
    return <div className="space-y-3 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={`/t/${slug}/automation/whatsapp-agents`}><ArrowLeft className="mr-1 size-4" /> Back to agents</Link>
          </Button>
          <h1 className="mt-2 flex items-center gap-2 font-display text-xl font-semibold">
            <MessageSquare className="size-5" />
            {isEdit ? state.name || 'Untitled agent' : 'New WhatsApp agent'}
            <StatusBadge status={currentStatus} />
          </h1>
        </div>
        {isEdit && (
          <div className="flex items-center gap-2">
            {currentStatus === 'ACTIVE' ? (
              <Button size="sm" variant="outline" onClick={() => pause.mutate({ id: agentId! })} disabled={pause.isPending}>
                <Pause className="mr-1 size-4" /> Pause
              </Button>
            ) : (
              <Button size="sm" onClick={() => activate.mutate({ id: agentId! })} disabled={activate.isPending}>
                <Play className="mr-1 size-4" /> Activate
              </Button>
            )}
            <Button size="sm" variant="ghost"
              onClick={() => { if (confirm('Delete this agent?')) remove.mutate({ id: agentId! }); }}
              className="text-rose-700">
              <Trash2 className="mr-1 size-4" /> Delete
            </Button>
          </div>
        )}
      </header>

      {/* Step strip — five equal columns on md+, stacks on mobile.
          Active step gets the brand yellow chip with a subtle ring so
          it reads as the current step without collapsing into a solid
          block of colour; labels wrap on narrower widths instead of
          truncating. */}
      <ol className="grid grid-cols-2 gap-1.5 rounded-lg border bg-card p-1.5 sm:grid-cols-3 md:grid-cols-5">
        {STEPS.map((s, i) => {
          const active = s.key === step;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(s.key)}
                className={cn(
                  'flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-xs font-medium transition-colors',
                  active
                    ? 'bg-amber-300 text-amber-950 shadow-sm ring-1 ring-amber-400/70 dark:bg-amber-400/90 dark:text-amber-950'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold',
                    active
                      ? 'bg-amber-950/15 text-amber-950'
                      : 'bg-muted-foreground/15 text-muted-foreground',
                  )}
                >
                  {i + 1}
                </span>
                <span>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="rounded-lg border bg-card p-5">
        {step === 'goal' && <GoalStep state={state} setState={setState} />}
        {step === 'knowledge' && <KnowledgeStep state={state} setState={setState} />}
        {step === 'audience' && <ScheduleStep state={state} setState={setState} />}
        {step === 'sender' && <SenderStep state={state} setState={setState}
          phones={phoneOptions.data ?? []} templates={templateOptions.data ?? []} />}
        {step === 'review' && <ReviewStep state={state}
          phones={phoneOptions.data ?? []} templates={templateOptions.data ?? []} isEdit={isEdit} />}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={currentStepIndex === 0}
          onClick={() => { const prev = STEPS[currentStepIndex - 1]; if (prev) setStep(prev.key); }}>
          <ChevronLeft className="mr-1 size-4" /> Back
        </Button>
        {step !== 'review' ? (
          <Button onClick={() => { const next = STEPS[currentStepIndex + 1]; if (next) setStep(next.key); }}>
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
    </div>
  );
}

function GoalStep({ state, setState }: { state: FormState; setState: React.Dispatch<React.SetStateAction<FormState>> }): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="Agent name" hint="Shown in your dashboard.">
        <Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })}
          placeholder="WhatsApp SDR" maxLength={120} />
      </Field>
      <Field label="Persona" hint="How the agent introduces itself + the voice it uses.">
        <textarea className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
          value={state.persona} onChange={(e) => setState({ ...state, persona: e.target.value })}
          placeholder="Friendly SDR at Getyn — warm, concise, never pushy." maxLength={4000} />
      </Field>
      <Field label="Goal" hint="What the agent is trying to accomplish.">
        <textarea className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
          value={state.goal} onChange={(e) => setState({ ...state, goal: e.target.value })}
          placeholder="Book a 20-min demo call with SMB owners who signed up in the last 30 days."
          maxLength={4000} />
      </Field>
      <Field label="Signature" hint="Appended to every outbound follow-up. Keep it short for WhatsApp.">
        <textarea className="min-h-16 w-full rounded-md border bg-background p-2 text-sm"
          value={state.signature} onChange={(e) => setState({ ...state, signature: e.target.value })}
          placeholder="— Sarah at Getyn" maxLength={2000} />
      </Field>
    </div>
  );
}

function KnowledgeStep({ state, setState }: { state: FormState; setState: React.Dispatch<React.SetStateAction<FormState>> }): JSX.Element {
  const [url, setUrl] = useState('');
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Knowledge URLs</p>
        <p className="text-xs text-muted-foreground">
          Reference URLs the agent can cite in follow-ups + replies (product page, pricing, FAQ).
        </p>
      </div>
      <ul className="divide-y rounded-md border">
        {state.knowledgeUrls.length === 0 ? (
          <li className="p-6 text-center text-xs text-muted-foreground">No URLs added yet.</li>
        ) : state.knowledgeUrls.map((u) => (
          <li key={u} className="flex items-center justify-between gap-3 p-2.5 text-sm">
            <span className="truncate">{u}</span>
            <Button size="sm" variant="ghost"
              onClick={() => setState({ ...state, knowledgeUrls: state.knowledgeUrls.filter((x) => x !== u) })}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://getyn.com/pricing" />
        <Button onClick={() => {
          const v = url.trim();
          if (!v) return;
          if (state.knowledgeUrls.length >= 20) return;
          setState({ ...state, knowledgeUrls: [...state.knowledgeUrls, v] });
          setUrl('');
        }} disabled={!url.trim()}>Add</Button>
      </div>
    </div>
  );
}

function ScheduleStep({ state, setState }: { state: FormState; setState: React.Dispatch<React.SetStateAction<FormState>> }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max follow-ups" hint="Up to 100.">
          <Input type="number" min={0} max={100} value={state.maxFollowUps}
            onChange={(e) => setState({ ...state, maxFollowUps: Math.max(0, Math.min(100, Number(e.target.value))) })} />
        </Field>
        <Field label="Cooling period (days)" hint="After the last outbound with no reply.">
          <Input type="number" min={0} max={365} value={state.coolingPeriodDays}
            onChange={(e) => setState({ ...state, coolingPeriodDays: Math.max(0, Math.min(365, Number(e.target.value))) })} />
        </Field>
      </div>
      <Field label="Follow-up schedule (days)" hint="Day offsets from the initial send. Free-form text only works inside the 24h reply window.">
        <Input value={state.followUpDays.join(', ')}
          onChange={(e) => setState({
            ...state,
            followUpDays: e.target.value.split(',').map((s) => Number.parseInt(s.trim(), 10))
              .filter((n) => Number.isFinite(n) && n > 0),
          })}
          placeholder="3, 7, 14" />
      </Field>
      <Field label="Stop keywords" hint="Reply containing any of these auto-moves the contact into Inactive.">
        <textarea rows={2} className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={state.stopKeywords} onChange={(e) => setState({ ...state, stopKeywords: e.target.value })}
          placeholder="stop, unsubscribe, do not message me, remove me" />
      </Field>
    </div>
  );
}

function SenderStep({
  state, setState, phones, templates,
}: {
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
  phones: Array<{ id: string; phoneNumber: string; verifiedName: string; displayPhoneNumberStatus: string }>;
  templates: Array<{ id: string; name: string; language: string; category: string }>;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Field label="Sender phone" hint="Meta-connected WhatsApp Business phone. Connect one under Settings → WhatsApp.">
        <Select value={state.phoneNumberId} onValueChange={(v) => setState({ ...state, phoneNumberId: v })}>
          <SelectTrigger><SelectValue placeholder="Pick a phone…" /></SelectTrigger>
          <SelectContent>
            {phones.length === 0 ? (
              <SelectItem value="none" disabled>No WhatsApp phones — connect one under Settings.</SelectItem>
            ) : phones.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.phoneNumber} — {p.verifiedName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Initial-touch template"
        hint="Meta requires an approved template for the first outbound outside the 24h session window. Follow-ups can be free-form text.">
        <Select value={state.initialTemplateId ?? 'none'}
          onValueChange={(v) => setState({ ...state, initialTemplateId: v === 'none' ? null : v })}>
          <SelectTrigger><SelectValue placeholder="Pick an APPROVED template…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None (agent cannot activate without one) —</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name} · {t.language} · {t.category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span className="font-medium">Reply routing:</span> inbound replies land in the WhatsApp Inbox
        and move the corresponding card to Review Response on the Kanban.
      </p>
    </div>
  );
}

function ReviewStep({
  state, phones, templates, isEdit,
}: {
  state: FormState;
  phones: Array<{ id: string; phoneNumber: string; verifiedName: string }>;
  templates: Array<{ id: string; name: string; language: string }>;
  isEdit: boolean;
}): JSX.Element {
  const phone = state.phoneNumberId ? phones.find((p) => p.id === state.phoneNumberId) : null;
  const tpl = state.initialTemplateId ? templates.find((t) => t.id === state.initialTemplateId) : null;
  const items = [
    ['Name', state.name || '(unnamed)'],
    ['Persona', state.persona || '(none)'],
    ['Goal', state.goal || '(none)'],
    ['Sender', phone ? `${phone.phoneNumber} — ${phone.verifiedName}` : '(not set)'],
    ['Initial template', tpl ? `${tpl.name} (${tpl.language})` : '(none — required to activate)'],
    ['Schedule', `Follow up on days ${state.followUpDays.join(', ') || '(none)'} (max ${state.maxFollowUps})`],
    ['Cooling', `${state.coolingPeriodDays} days`],
    ['Knowledge URLs', state.knowledgeUrls.length ? `${state.knowledgeUrls.length} URL(s)` : '(none)'],
  ];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Review</p>
        <p className="text-xs text-muted-foreground">Save the agent as a draft, then Activate to start enrolling contacts.</p>
      </div>
      <dl className="divide-y rounded-md border">
        {items.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 p-3">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd className="text-sm">{v}</dd>
          </div>
        ))}
      </dl>
      {!isEdit && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          After you save, we&apos;ll route you to the agent&apos;s edit page. Activation requires an approved initial template.
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
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
    ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAUSED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ARCHIVED: 'bg-muted text-muted-foreground opacity-70',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide', map[status])}>{status}</span>
  );
}
