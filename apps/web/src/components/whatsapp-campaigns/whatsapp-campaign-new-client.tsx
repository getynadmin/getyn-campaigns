'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  Loader2,
  MessageSquare,
  Phone,
  Send,
  Users,
} from 'lucide-react';

import {
  countVariables,
  type TemplateComponent,
} from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

type Step = 'identity' | 'content' | 'review';

interface VariableState {
  /** 'static' = literal string, 'merge' = contact field tag. */
  type: 'static' | 'merge';
  value: string;
}

const MERGE_TAGS = [
  { value: 'contact.firstName', label: 'First name' },
  { value: 'contact.lastName', label: 'Last name' },
  { value: 'contact.fullName', label: 'Full name' },
  { value: 'contact.email', label: 'Email' },
  { value: 'contact.phone', label: 'Phone' },
];

export function WhatsAppCampaignNewClient({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identity');

  // Step 1
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState<string>('');

  // Step 2
  const [phoneNumberId, setPhoneNumberId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('');
  const [variables, setVariables] = useState<VariableState[]>([]);

  // Schedule
  const [scheduledAt, setScheduledAt] = useState<string>('');

  const segments = api.segments.list.useQuery({ limit: 100 });
  const accountQ = api.whatsAppAccount.get.useQuery();
  const templatesQ = api.whatsAppTemplate.list.useQuery({ status: 'APPROVED' });

  const phoneNumbers = accountQ.data?.phoneNumbers ?? [];
  const templates = templatesQ.data?.items ?? [];

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  // Auto-resize variables array to template's body variable count.
  const bodyVarCount = useMemo(() => {
    if (!selectedTemplate) return 0;
    const comps = (selectedTemplate.components ?? []) as TemplateComponent[];
    const body = comps.find((c) => c.type === 'BODY');
    return body && body.type === 'BODY' ? countVariables(body.text) : 0;
  }, [selectedTemplate]);

  if (variables.length !== bodyVarCount) {
    setTimeout(() => {
      setVariables((vs) => {
        const next = [...vs];
        while (next.length < bodyVarCount) {
          next.push({ type: 'static', value: '' });
        }
        next.length = bodyVarCount;
        return next;
      });
    }, 0);
  }

  const utils = api.useUtils();
  const createMut = api.whatsAppCampaign.create.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const sendNow = api.whatsAppCampaign.sendNow.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const schedule = api.whatsAppCampaign.schedule.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const step1Valid = name.trim().length >= 1 && segmentId.length > 0;
  const step2Valid =
    phoneNumberId.length > 0 &&
    templateId.length > 0 &&
    variables.every((v) => v.value.length > 0) &&
    Boolean(selectedTemplate);

  const submit = async (mode: 'now' | 'schedule'): Promise<void> => {
    if (!selectedTemplate) return;
    try {
      const created = await createMut.mutateAsync({
        name: name.trim(),
        segmentId,
        phoneNumberId,
        templateId,
        templateLanguage: selectedTemplate.language,
        templateVariables: variables.map((v) => ({
          type: v.type,
          value: v.value,
        })),
      });
      if (mode === 'now') {
        await sendNow.mutateAsync({ id: created.id });
        toast.success(
          'Campaign queued — sends will appear in the campaign detail as Meta acknowledges them.',
        );
      } else {
        if (!scheduledAt) {
          toast.error('Pick a scheduled date/time first.');
          return;
        }
        await schedule.mutateAsync({
          id: created.id,
          scheduledAt: new Date(scheduledAt).toISOString(),
        });
        toast.success('Campaign scheduled.');
      }
      // List invalidate would normally fire here — whatsAppCampaign.list
      // lands as a future enhancement (M9/M12). For now the campaign
      // appears via the existing Phase 3 campaign router list which
      // unions both types.
      void utils.campaign?.list?.invalidate();
      router.push(`/t/${tenantSlug}/campaigns`);
    } catch {
      // toasts already fired in onError
    }
  };

  // Empty / not-connected states
  if (accountQ.isLoading || templatesQ.isLoading || segments.isLoading) {
    return <Skeleton className="h-96" />;
  }
  if (!accountQ.data || accountQ.data.status !== 'CONNECTED') {
    return (
      <ConnectFirst tenantSlug={tenantSlug} reason="No connected WhatsApp account." />
    );
  }
  if (templates.length === 0) {
    return (
      <ConnectFirst
        tenantSlug={tenantSlug}
        reason="No APPROVED templates yet. Author one and submit to Meta first."
        templatesPath
      />
    );
  }

  return (
    <div className="space-y-4">
      <Stepper step={step} />

      {step === 'identity' && (
        <Section title="Identity">
          <Field label="Campaign name (internal)">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring promotion — week 1"
            />
          </Field>
          <Field label="Recipient segment">
            <Select
              value={segmentId}
              onValueChange={setSegmentId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a segment" />
              </SelectTrigger>
              <SelectContent>
                {(segments.data?.items ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Suppression-listed and unsubscribed contacts are excluded
              automatically at send time.
            </p>
          </Field>
          <div className="flex justify-end">
            <Button
              disabled={!step1Valid}
              onClick={() => setStep('content')}
            >
              Next
            </Button>
          </div>
        </Section>
      )}

      {step === 'content' && (
        <Section title="Template + variables">
          <Field label="Send from phone">
            <Select
              value={phoneNumberId}
              onValueChange={setPhoneNumberId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a registered phone" />
              </SelectTrigger>
              <SelectContent>
                {phoneNumbers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="font-mono">{p.phoneNumber}</span> —{' '}
                    {p.verifiedName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Template">
            <Select
              value={templateId}
              onValueChange={(v) => {
                setTemplateId(v);
                setVariables([]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick an APPROVED template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="font-mono">{t.name}</span> · {t.language} ·{' '}
                    {t.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {selectedTemplate && bodyVarCount > 0 && (
            <Field label={`Variables (${bodyVarCount})`}>
              <div className="space-y-2">
                {variables.map((v, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[110px_120px_1fr] items-center gap-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {`{{${i + 1}}}`}
                    </span>
                    <Select
                      value={v.type}
                      onValueChange={(t) => {
                        const next = [...variables];
                        next[i] = {
                          type: t as 'static' | 'merge',
                          value: t === 'merge' ? 'contact.firstName' : '',
                        };
                        setVariables(next);
                      }}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="static">Static text</SelectItem>
                        <SelectItem value="merge">Contact field</SelectItem>
                      </SelectContent>
                    </Select>
                    {v.type === 'static' ? (
                      <Input
                        value={v.value}
                        onChange={(e) => {
                          const next = [...variables];
                          next[i] = { type: 'static', value: e.target.value };
                          setVariables(next);
                        }}
                        placeholder="Static text"
                      />
                    ) : (
                      <Select
                        value={v.value}
                        onValueChange={(val) => {
                          const next = [...variables];
                          next[i] = { type: 'merge', value: val };
                          setVariables(next);
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MERGE_TAGS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                <Info className="mr-1 inline size-3" /> Static text is the
                same for everyone. Contact fields resolve per-recipient at
                send time — empty fields render as empty string.
              </p>
            </Field>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('identity')}>
              <ArrowLeft className="mr-2 size-3.5" /> Back
            </Button>
            <Button
              disabled={!step2Valid}
              onClick={() => setStep('review')}
            >
              Next: Review
            </Button>
          </div>
        </Section>
      )}

      {step === 'review' && selectedTemplate && (
        <Section title="Review + send">
          <ReviewCard
            name={name}
            segmentName={
              (segments.data?.items ?? []).find((s) => s.id === segmentId)?.name ??
              ''
            }
            phone={
              phoneNumbers.find((p) => p.id === phoneNumberId)?.phoneNumber ?? ''
            }
            templateName={selectedTemplate.name}
            language={selectedTemplate.language}
            variables={variables}
          />
          <Field label="Schedule (optional)">
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave blank to send immediately.
            </p>
          </Field>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('content')}>
              <ArrowLeft className="mr-2 size-3.5" /> Back
            </Button>
            <div className="flex gap-2">
              {scheduledAt ? (
                <Button
                  disabled={createMut.isPending || schedule.isPending}
                  onClick={() => submit('schedule')}
                >
                  {(createMut.isPending || schedule.isPending) && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Schedule
                </Button>
              ) : (
                <Button
                  disabled={createMut.isPending || sendNow.isPending}
                  onClick={() => submit('now')}
                >
                  {(createMut.isPending || sendNow.isPending) && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  <Send className="mr-2 size-4" />
                  Send now
                </Button>
              )}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }): JSX.Element {
  const steps: Array<{ key: Step; label: string; icon: typeof Users }> = [
    { key: 'identity', label: 'Identity', icon: Users },
    { key: 'content', label: 'Content', icon: MessageSquare },
    { key: 'review', label: 'Review', icon: Send },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">
      {steps.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        const Icon = s.icon;
        return (
          <li
            key={s.key}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1',
              active && 'bg-primary/10 font-medium',
              done && 'text-emerald-700 dark:text-emerald-300',
              !active && !done && 'text-muted-foreground',
            )}
          >
            {done ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <Icon className="size-3.5" />
            )}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function ReviewCard({
  name,
  segmentName,
  phone,
  templateName,
  language,
  variables,
}: {
  name: string;
  segmentName: string;
  phone: string;
  templateName: string;
  language: string;
  variables: VariableState[];
}): JSX.Element {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Campaign</span>
        <span className="font-medium">{name}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Segment</span>
        <span>{segmentName}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Phone</span>
        <span className="flex items-center gap-1">
          <Phone className="size-3" /> <span className="font-mono">{phone}</span>
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Template</span>
        <span className="flex items-center gap-1">
          <span className="font-mono">{templateName}</span> · {language}
        </span>
      </div>
      {variables.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Variables</p>
          <ul className="space-y-1 text-xs">
            {variables.map((v, i) => (
              <li key={i} className="flex justify-between">
                <span className="font-mono">{`{{${i + 1}}}`}</span>
                <span>
                  {v.type === 'merge' ? (
                    <code className="rounded bg-muted px-1">{v.value}</code>
                  ) : (
                    <span>&quot;{v.value}&quot;</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConnectFirst({
  tenantSlug,
  reason,
  templatesPath = false,
}: {
  tenantSlug: string;
  reason: string;
  templatesPath?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center">
      <h3 className="text-base font-semibold">{reason}</h3>
      <Button asChild className="mt-4">
        <a
          href={
            templatesPath
              ? `/t/${tenantSlug}/settings/channels/whatsapp/templates`
              : `/t/${tenantSlug}/settings/channels/whatsapp`
          }
        >
          {templatesPath ? 'Go to templates' : 'Go to WhatsApp settings'}
        </a>
      </Button>
    </div>
  );
}
