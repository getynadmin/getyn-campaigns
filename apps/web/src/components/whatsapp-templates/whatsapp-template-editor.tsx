'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
} from 'lucide-react';

import {
  countVariables,
  templateComponentsSchema,
  validateForCategory,
  type TemplateButton,
  type TemplateComponent,
  type TemplateDraft,
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

/**
 * Template editor (Phase 4 M6).
 *
 * Single client component handling create + edit, locally-staged form
 * state, real-time validation against templateComponentsSchema +
 * validateForCategory, and a side-by-side WhatsApp-style preview.
 *
 * Multi-step is rendered as accordion sections rather than a stepper
 * so users can flip between fields without losing state. The
 * "submit" button is gated by schema validity — clicked, it calls the
 * tRPC submit mutation which fire-and-forgets the Meta call + poll
 * chain and routes back to the list.
 *
 * On edit-of-non-DRAFT, the editor flips into read-only mode and shows
 * a "Duplicate as draft" CTA.
 */

const LANGUAGES = [
  { value: 'en_US', label: 'English (US)' },
  { value: 'en_GB', label: 'English (UK)' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt_BR', label: 'Portuguese (Brazil)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'id', label: 'Indonesian' },
  { value: 'vi', label: 'Vietnamese' },
];

type ButtonType = TemplateButton['type'];
type Mode = 'create' | 'edit';

interface EditorProps {
  tenantSlug: string;
  mode: Mode;
  templateId?: string;
  initialStatus?: string;
}

interface EditorState {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  headerEnabled: boolean;
  headerFormat: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  headerText: string;
  headerExampleText: string; // for {{1}} in header
  body: string;
  bodyExamples: string[]; // length = N variables
  footerEnabled: boolean;
  footerText: string;
  buttonsEnabled: boolean;
  buttons: TemplateButton[];
}

const blankState: EditorState = {
  name: '',
  language: 'en_US',
  category: 'UTILITY',
  headerEnabled: false,
  headerFormat: 'TEXT',
  headerText: '',
  headerExampleText: '',
  body: '',
  bodyExamples: [],
  footerEnabled: false,
  footerText: '',
  buttonsEnabled: false,
  buttons: [],
};

export function WhatsAppTemplateEditor({
  tenantSlug,
  mode,
  templateId,
  initialStatus,
}: EditorProps): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const isReadOnly = mode === 'edit' && initialStatus !== 'DRAFT';

  const { data: existing, isLoading: loadingExisting } =
    api.whatsAppTemplate.get.useQuery(
      { id: templateId ?? '' },
      { enabled: mode === 'edit' && Boolean(templateId) },
    );

  const [state, setState] = useState<EditorState>(blankState);

  // Hydrate state from existing when loaded.
  useEffect(() => {
    if (mode !== 'edit' || !existing) return;
    setState(deserialize(existing));
  }, [existing, mode]);

  // Build the canonical components array from form state for validation + preview.
  const components = useMemo(() => buildComponents(state), [state]);
  const draft: TemplateDraft = useMemo(
    () => ({
      name: state.name,
      language: state.language,
      category: state.category,
      components,
    }),
    [state.name, state.language, state.category, components],
  );

  const validation = useMemo(() => {
    const result = templateComponentsSchema.safeParse(components);
    const editorialIssues = result.success ? validateForCategory(draft) : [];
    return { result, editorialIssues };
  }, [components, draft]);

  const create = api.whatsAppTemplate.create.useMutation({
    onSuccess: ({ template, editorialIssues }) => {
      if (editorialIssues.length > 0) {
        toast.warning(
          `Saved as draft with ${editorialIssues.length} editorial warning(s). Review before submit.`,
        );
      } else {
        toast.success('Saved as draft.');
      }
      void utils.whatsAppTemplate.list.invalidate();
      router.push(
        `/t/${tenantSlug}/settings/channels/whatsapp/templates/${template.id}/edit`,
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const update = api.whatsAppTemplate.update.useMutation({
    onSuccess: () => {
      toast.success('Draft updated.');
      void utils.whatsAppTemplate.list.invalidate();
      void utils.whatsAppTemplate.get.invalidate({ id: templateId ?? '' });
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = api.whatsAppTemplate.submit.useMutation({
    onSuccess: () => {
      toast.success(
        'Submitted to Meta. We’ll update the status here as Meta responds (usually within a few minutes).',
      );
      void utils.whatsAppTemplate.list.invalidate();
      router.push(`/t/${tenantSlug}/settings/channels/whatsapp/templates`);
    },
    onError: (err) => toast.error(err.message),
  });

  const duplicate = api.whatsAppTemplate.duplicate.useMutation({
    onSuccess: (row) => {
      toast.success('Duplicated as draft.');
      router.push(
        `/t/${tenantSlug}/settings/channels/whatsapp/templates/${row.id}/edit`,
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.whatsAppTemplate.delete.useMutation({
    onSuccess: () => {
      toast.success('Template deleted.');
      router.push(`/t/${tenantSlug}/settings/channels/whatsapp/templates`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (mode === 'edit' && loadingExisting) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // Sync bodyExamples length to variable count, preserving existing values.
  const bodyVarCount = countVariables(state.body);
  if (bodyVarCount !== state.bodyExamples.length) {
    setTimeout(() => {
      setState((s) => {
        const next = [...s.bodyExamples];
        while (next.length < bodyVarCount) next.push('');
        next.length = bodyVarCount;
        return { ...s, bodyExamples: next };
      });
    }, 0);
  }

  const isValid = validation.result.success;
  const issues = validation.result.success
    ? []
    : validation.result.error.issues;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            router.push(`/t/${tenantSlug}/settings/channels/whatsapp/templates`)
          }
        >
          <ArrowLeft className="mr-2 size-3.5" /> Back to templates
        </Button>
        {mode === 'edit' && existing && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => duplicate.mutate({ id: existing.id })}
              disabled={duplicate.isPending}
            >
              <Copy className="mr-2 size-3.5" /> Duplicate as draft
            </Button>
            {isReadOnly ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteMutation.mutate({ id: existing.id })}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 size-3.5" /> Delete
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className={cn('space-y-6', isReadOnly && 'pointer-events-none opacity-70')}>
          <Section title="Identity">
            <Field label="Name">
              <Input
                value={state.name}
                onChange={(e) =>
                  setState({ ...state, name: e.target.value.toLowerCase() })
                }
                placeholder="order_shipped_v2"
                pattern="^[a-z][a-z0-9_]*$"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lowercase letters / digits / underscores. Starts with a letter.
              </p>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language">
                <Select
                  value={state.language}
                  onValueChange={(v) => setState({ ...state, language: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Category">
                <Select
                  value={state.category}
                  onValueChange={(v) =>
                    setState({
                      ...state,
                      category: v as EditorState['category'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utility</SelectItem>
                    <SelectItem value="AUTHENTICATION">
                      Authentication
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>

          <Section title="Header (optional)">
            <Toggle
              checked={state.headerEnabled}
              onChange={(checked) =>
                setState({ ...state, headerEnabled: checked })
              }
              label="Add a header"
            />
            {state.headerEnabled && (
              <div className="space-y-3">
                <Field label="Format">
                  <Select
                    value={state.headerFormat}
                    onValueChange={(v) =>
                      setState({
                        ...state,
                        headerFormat: v as EditorState['headerFormat'],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEXT">Text</SelectItem>
                      <SelectItem value="IMAGE">Image</SelectItem>
                      <SelectItem value="VIDEO">Video</SelectItem>
                      <SelectItem value="DOCUMENT">Document</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {state.headerFormat === 'TEXT' && (
                  <>
                    <Field label="Header text (60 char max)">
                      <Input
                        value={state.headerText}
                        onChange={(e) =>
                          setState({ ...state, headerText: e.target.value })
                        }
                        maxLength={60}
                        placeholder="Order shipped"
                      />
                    </Field>
                    {/\{\{1\}\}/.test(state.headerText) && (
                      <Field label="Example value for header {{1}}">
                        <Input
                          value={state.headerExampleText}
                          onChange={(e) =>
                            setState({
                              ...state,
                              headerExampleText: e.target.value,
                            })
                          }
                          placeholder="Welcome back"
                        />
                      </Field>
                    )}
                  </>
                )}
                {state.headerFormat !== 'TEXT' && (
                  <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                    <ImageIcon className="mr-1 inline-block size-3.5" />
                    Media uploads land in M9 (assets pipeline). For now,
                    M6 supports text-format headers only — pick TEXT to
                    submit, or save as draft and revisit after M9.
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section title="Body" required>
            <Field label="Message body (1024 char max)">
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                rows={6}
                value={state.body}
                onChange={(e) => setState({ ...state, body: e.target.value })}
                maxLength={1024}
                placeholder="Hi {{1}}, your order {{2}} has shipped."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Use <code className="rounded bg-muted px-1">{`{{1}}`}</code>,{' '}
                <code className="rounded bg-muted px-1">{`{{2}}`}</code>,{' '}
                ... for variables. {bodyVarCount} variable
                {bodyVarCount === 1 ? '' : 's'} detected.
              </p>
            </Field>
            {bodyVarCount > 0 && (
              <Field label="Example values">
                <div className="space-y-2">
                  {state.bodyExamples.map((v, i) => (
                    <Input
                      key={i}
                      value={v}
                      onChange={(e) => {
                        const next = [...state.bodyExamples];
                        next[i] = e.target.value;
                        setState({ ...state, bodyExamples: next });
                      }}
                      placeholder={`Example for {{${i + 1}}}`}
                    />
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Meta uses these to render approvals and preview the
                  message internally.
                </p>
              </Field>
            )}
          </Section>

          <Section title="Footer (optional)">
            <Toggle
              checked={state.footerEnabled}
              onChange={(checked) =>
                setState({ ...state, footerEnabled: checked })
              }
              label="Add a footer"
            />
            {state.footerEnabled && (
              <Field label="Footer text (60 char max)">
                <Input
                  value={state.footerText}
                  onChange={(e) =>
                    setState({ ...state, footerText: e.target.value })
                  }
                  maxLength={60}
                  placeholder="Reply STOP to opt out."
                />
              </Field>
            )}
          </Section>

          <Section title="Buttons (optional, max 3)">
            <Toggle
              checked={state.buttonsEnabled}
              onChange={(checked) =>
                setState({ ...state, buttonsEnabled: checked })
              }
              label="Add buttons"
            />
            {state.buttonsEnabled && (
              <ButtonsEditor
                buttons={state.buttons}
                onChange={(buttons) => setState({ ...state, buttons })}
              />
            )}
          </Section>

          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950">
              <p className="flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-3.5" />
                Validation issues ({issues.length})
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-200">
                {issues.slice(0, 6).map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
                {issues.length > 6 && (
                  <li>… and {issues.length - 6} more</li>
                )}
              </ul>
            </div>
          )}

          {validation.editorialIssues.length > 0 && isValid && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="flex items-center gap-1 font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-3.5" />
                Editorial warnings — Meta may reject
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-200">
                {validation.editorialIssues.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            </div>
          )}

          {!isReadOnly && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={!isValid || create.isPending || update.isPending}
                onClick={() => {
                  if (mode === 'create') {
                    create.mutate(draft);
                  } else if (templateId) {
                    update.mutate({
                      id: templateId,
                      patch: {
                        name: state.name,
                        language: state.language,
                        category: state.category,
                        components,
                      },
                    });
                  }
                }}
              >
                {(create.isPending || update.isPending) && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                <Save className="mr-2 size-4" />
                Save draft
              </Button>
              <Button
                disabled={
                  !isValid ||
                  submit.isPending ||
                  mode === 'create' ||
                  (mode === 'edit' && existing?.status !== 'DRAFT')
                }
                onClick={() => templateId && submit.mutate({ id: templateId })}
                title={
                  mode === 'create'
                    ? 'Save the draft first, then submit'
                    : undefined
                }
              >
                {submit.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                <Send className="mr-2 size-4" />
                Submit to Meta
              </Button>
            </div>
          )}

          {isReadOnly && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p>
                <strong>Read-only.</strong> Meta does not allow editing of
                templates after submission. Click <em>Duplicate as draft</em>{' '}
                up top to create a new editable version.
              </p>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border bg-[#e5ddd5] p-4 dark:bg-zinc-900">
            <p className="mb-3 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            <Preview state={state} />
          </div>
          {isValid ? (
            <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3" />
              Schema valid · ready to save
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Fix validation issues to save.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Pieces
// ----------------------------------------------------------------------------

function Section({
  title,
  required = false,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border bg-card p-5 space-y-3">
      <h3 className="text-sm font-semibold">
        {title}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </h3>
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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border"
      />
      {label}
    </label>
  );
}

function ButtonsEditor({
  buttons,
  onChange,
}: {
  buttons: TemplateButton[];
  onChange: (buttons: TemplateButton[]) => void;
}): JSX.Element {
  const update = (i: number, b: TemplateButton): void => {
    const next = [...buttons];
    next[i] = b;
    onChange(next);
  };
  const remove = (i: number): void => onChange(buttons.filter((_, j) => j !== i));
  const add = (type: ButtonType): void => {
    if (buttons.length >= 3) return;
    const fresh: TemplateButton =
      type === 'QUICK_REPLY'
        ? { type: 'QUICK_REPLY', text: '' }
        : type === 'URL'
        ? { type: 'URL', text: '', url: 'https://' }
        : type === 'PHONE_NUMBER'
        ? { type: 'PHONE_NUMBER', text: '', phone_number: '+1' }
        : { type: 'COPY_CODE', example: '' };
    onChange([...buttons, fresh]);
  };
  return (
    <div className="space-y-3">
      {buttons.map((b, i) => (
        <div key={i} className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {b.type.replace('_', ' ')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(i)}
              className="h-7 px-2"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {b.type !== 'COPY_CODE' && (
            <Field label="Label">
              <Input
                value={b.text}
                onChange={(e) =>
                  update(i, { ...b, text: e.target.value } as TemplateButton)
                }
                maxLength={25}
              />
            </Field>
          )}
          {b.type === 'URL' && (
            <Field label="URL">
              <Input
                value={b.url}
                onChange={(e) => update(i, { ...b, url: e.target.value })}
                placeholder="https://acme.test/{{1}}"
              />
            </Field>
          )}
          {b.type === 'PHONE_NUMBER' && (
            <Field label="Phone (E.164)">
              <Input
                value={b.phone_number}
                onChange={(e) =>
                  update(i, { ...b, phone_number: e.target.value })
                }
                placeholder="+14155551234"
              />
            </Field>
          )}
          {b.type === 'COPY_CODE' && (
            <Field label="Example code">
              <Input
                value={b.example}
                onChange={(e) => update(i, { ...b, example: e.target.value })}
                maxLength={15}
                placeholder="123456"
              />
            </Field>
          )}
        </div>
      ))}
      {buttons.length < 3 && (
        <div className="flex flex-wrap gap-2">
          {(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE'] as ButtonType[]).map((t) => (
            <Button
              key={t}
              variant="outline"
              size="sm"
              onClick={() => add(t)}
            >
              <Plus className="mr-1 size-3" />
              {t.replace('_', ' ').toLowerCase()}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Preview({ state }: { state: EditorState }): JSX.Element {
  return (
    <div className="rounded-lg bg-white p-3 text-sm shadow-sm dark:bg-zinc-800">
      {state.headerEnabled && state.headerFormat === 'TEXT' && state.headerText && (
        <div className="font-semibold">
          {renderWithExamples(state.headerText, [state.headerExampleText])}
        </div>
      )}
      {state.headerEnabled && state.headerFormat !== 'TEXT' && (
        <div className="mb-2 grid h-24 place-items-center rounded-md bg-muted text-xs text-muted-foreground">
          {state.headerFormat} header
        </div>
      )}
      {state.body && (
        <div className="mt-1 whitespace-pre-wrap">
          {renderWithExamples(state.body, state.bodyExamples)}
        </div>
      )}
      {state.footerEnabled && state.footerText && (
        <div className="mt-2 text-xs text-muted-foreground">
          {state.footerText}
        </div>
      )}
      {state.buttonsEnabled && state.buttons.length > 0 && (
        <div className="mt-3 space-y-1">
          {state.buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-center text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
            >
              {b.type === 'COPY_CODE' ? `📋 ${b.example}` : b.text || '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// State <-> components serialization
// ----------------------------------------------------------------------------

function buildComponents(state: EditorState): TemplateComponent[] {
  const comps: TemplateComponent[] = [];
  if (state.headerEnabled) {
    if (state.headerFormat === 'TEXT' && state.headerText) {
      const hasVar = /\{\{1\}\}/.test(state.headerText);
      comps.push({
        type: 'HEADER',
        format: 'TEXT',
        text: state.headerText,
        ...(hasVar
          ? {
              example: {
                header_text: [state.headerExampleText || 'sample'],
              },
            }
          : {}),
      });
    } else if (state.headerFormat !== 'TEXT') {
      comps.push({ type: 'HEADER', format: state.headerFormat });
    }
  }
  comps.push({
    type: 'BODY',
    text: state.body,
    ...(state.bodyExamples.length > 0 &&
    state.bodyExamples.every((e) => e.length > 0)
      ? {
          example: { body_text: [state.bodyExamples] },
        }
      : {}),
  });
  if (state.footerEnabled && state.footerText) {
    comps.push({ type: 'FOOTER', text: state.footerText });
  }
  if (state.buttonsEnabled && state.buttons.length > 0) {
    comps.push({ type: 'BUTTONS', buttons: state.buttons });
  }
  return comps;
}

interface ExistingTemplate {
  name: string;
  language: string;
  category: string;
  components: unknown;
}

function deserialize(t: ExistingTemplate): EditorState {
  const comps = (t.components ?? []) as TemplateComponent[];
  const header = comps.find((c) => c.type === 'HEADER');
  const body = comps.find((c) => c.type === 'BODY');
  const footer = comps.find((c) => c.type === 'FOOTER');
  const buttons = comps.find((c) => c.type === 'BUTTONS');
  return {
    name: t.name,
    language: t.language,
    category: t.category as EditorState['category'],
    headerEnabled: Boolean(header),
    headerFormat:
      header && header.type === 'HEADER'
        ? (header.format === 'LOCATION' ? 'TEXT' : header.format)
        : 'TEXT',
    headerText:
      header && header.type === 'HEADER' && header.format === 'TEXT'
        ? header.text ?? ''
        : '',
    headerExampleText:
      header &&
      header.type === 'HEADER' &&
      header.example?.header_text?.[0]
        ? header.example.header_text[0]
        : '',
    body: body && body.type === 'BODY' ? body.text : '',
    bodyExamples:
      body && body.type === 'BODY' && body.example?.body_text?.[0]
        ? body.example.body_text[0]
        : [],
    footerEnabled: Boolean(footer),
    footerText: footer && footer.type === 'FOOTER' ? footer.text : '',
    buttonsEnabled: Boolean(buttons),
    buttons:
      buttons && buttons.type === 'BUTTONS' ? buttons.buttons : [],
  };
}

// ----------------------------------------------------------------------------
// Variable interpolation for the live preview
// ----------------------------------------------------------------------------

function renderWithExamples(text: string, examples: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const idx = Number(n) - 1;
    return examples[idx] && examples[idx].length > 0
      ? examples[idx]
      : `{{${n}}}`;
  });
}
