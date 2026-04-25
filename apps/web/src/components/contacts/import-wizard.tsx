'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { ArrowLeft, Check, Loader2, Upload } from 'lucide-react';

import {
  type ImportColumnMapping,
  type ImportDedupeStrategyValue,
  type ImportMapping,
  type SubscriptionStatusValue,
} from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/trpc';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { cn } from '@/lib/utils';

import { TagChip } from './tag-chip';

type ContactField =
  | 'email'
  | 'phone'
  | 'firstName'
  | 'lastName'
  | 'language'
  | 'timezone';

const CONTACT_FIELD_LABEL: Record<ContactField, string> = {
  email: 'Email',
  phone: 'Phone',
  firstName: 'First name',
  lastName: 'Last name',
  language: 'Language',
  timezone: 'Timezone',
};

/** First ~100 rows we preview in-browser during the mapping step. */
const PREVIEW_ROW_LIMIT = 100;

/** Keep it small — papaparse reads the whole file in memory once. */
const MAX_BYTES = 50 * 1024 * 1024;

type PreviewState = {
  file: File;
  headers: string[];
  rows: Record<string, string>[];
  totalParsedRows: number;
};

type Step = 'upload' | 'map' | 'review' | 'running';

type Props = {
  tenantSlug: string;
};

/**
 * Multi-step CSV import wizard.
 *
 *   Upload → Map columns → Review options → Run
 *
 * The first three steps are purely client-side: we parse a slice of the file
 * with papaparse so the user can map visible columns without any network
 * round-trips. Only the final "Run" step uploads the file (signed URL from
 * the server, direct browser → Supabase Storage PUT) and calls
 * `imports.start` to enqueue the worker job.
 */
export function ImportWizard({ tenantSlug }: Props): JSX.Element {
  const router = useRouter();

  const [step, setStep] = useState<Step>('upload');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Step 2 state: per-column mapping choice.
  const [mapping, setMapping] = useState<Record<string, ImportColumnMapping>>({});

  // Step 3 state: import options.
  const [dedupeBy, setDedupeBy] =
    useState<ImportDedupeStrategyValue>('EMAIL_OR_PHONE');
  const [defaultEmailStatus, setDefaultEmailStatus] =
    useState<SubscriptionStatusValue>('SUBSCRIBED');
  const [defaultSmsStatus, setDefaultSmsStatus] =
    useState<SubscriptionStatusValue>('SUBSCRIBED');
  const [defaultWhatsappStatus, setDefaultWhatsappStatus] =
    useState<SubscriptionStatusValue>('SUBSCRIBED');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Data needed from the server.
  const customFields = api.customFields.list.useQuery();
  const tags = api.tags.list.useQuery();

  const requestUpload = api.imports.requestUpload.useMutation();
  const startImport = api.imports.start.useMutation();

  // ---------- Step 1: pick a file ----------------------------------------
  const handleFile = (file: File): void => {
    setParseError(null);
    if (file.size > MAX_BYTES) {
      setParseError('That file is larger than 50MB. Split it into smaller chunks.');
      return;
    }

    // Read as text first so we can give the user a preview without waiting
    // for the upload. PapaParse can stream, but for preview simplicity we
    // take the whole file text here.
    file.text().then((text) => {
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: 'greedy',
        preview: PREVIEW_ROW_LIMIT,
      });
      if (parsed.errors.length > 0 && !parsed.data.length) {
        setParseError('Could not parse the file as CSV. Check the format.');
        return;
      }
      const headers = parsed.meta.fields ?? [];
      if (headers.length === 0) {
        setParseError(
          'We could not find a header row. Your first row should list column names.',
        );
        return;
      }
      setPreview({
        file,
        headers,
        rows: parsed.data,
        totalParsedRows: parsed.data.length,
      });
      // Seed mapping with best-effort auto-match against contact fields.
      setMapping(autoMatchHeaders(headers));
      setStep('map');
    });
  };

  // ---------- Step 2 → Step 3: validate mapping ---------------------------
  const goToReview = (): void => {
    // Require at least email or phone.
    const hasIdentity = Object.values(mapping).some(
      (m) =>
        m.kind === 'field' && (m.field === 'email' || m.field === 'phone'),
    );
    if (!hasIdentity) {
      toast.error('Map at least one column to email or phone.');
      return;
    }
    // Detect duplicate contact-field mappings.
    const usedFields = new Map<ContactField, string>();
    for (const [col, entry] of Object.entries(mapping)) {
      if (entry.kind === 'field') {
        const prev = usedFields.get(entry.field);
        if (prev) {
          toast.error(
            `Both "${prev}" and "${col}" are mapped to ${entry.field}. Pick one.`,
          );
          return;
        }
        usedFields.set(entry.field, col);
      }
    }
    setStep('review');
  };

  // ---------- Step 3 → Step 4: run ---------------------------------------
  const run = async (): Promise<void> => {
    if (!preview) return;
    setStep('running');

    try {
      // 1) Ask the server for a signed upload URL.
      const signed = await requestUpload.mutateAsync({
        fileName: preview.file.name,
        size: preview.file.size,
      });

      // 2) Upload directly to Supabase Storage.
      const supabase = createSupabaseBrowserClient();
      const upload = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.storagePath, signed.token, preview.file, {
          contentType: 'text/csv',
          upsert: false,
        });
      if (upload.error) {
        throw new Error(`Upload failed: ${upload.error.message}`);
      }

      // 3) Build the mapping payload. We only send columns the user
      //    actually used — skip entries are implied by omission.
      const mappingPayload: ImportMapping = {};
      for (const [column, entry] of Object.entries(mapping)) {
        if (entry.kind !== 'skip') mappingPayload[column] = entry;
      }

      // 4) Start the import — server creates ImportJob row + enqueues.
      const { id } = await startImport.mutateAsync({
        fileName: preview.file.name,
        storagePath: signed.storagePath,
        mapping: mappingPayload,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        dedupeBy,
        defaultEmailStatus,
        defaultSmsStatus,
        defaultWhatsappStatus,
      });

      toast.success('Import queued.');
      router.push(`/t/${tenantSlug}/contacts/import/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
      setStep('review');
    }
  };

  // ---------- Render ------------------------------------------------------
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div>
        <Link
          href={`/t/${tenantSlug}/contacts`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All contacts
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
          Import contacts
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV, map its columns to contact fields, and we&rsquo;ll
          import them in the background.
        </p>
      </div>

      <StepStrip step={step} />

      {step === 'upload' ? (
        <UploadStep onFile={handleFile} error={parseError} />
      ) : null}

      {step === 'map' && preview ? (
        <MapStep
          preview={preview}
          mapping={mapping}
          onMappingChange={setMapping}
          customFields={(customFields.data ?? []).map((f) => ({
            id: f.id,
            label: f.label,
            key: f.key,
            type: f.type,
          }))}
          onBack={() => {
            setPreview(null);
            setMapping({});
            setStep('upload');
          }}
          onNext={goToReview}
        />
      ) : null}

      {step === 'review' && preview ? (
        <ReviewStep
          preview={preview}
          mapping={mapping}
          dedupeBy={dedupeBy}
          onDedupeChange={setDedupeBy}
          defaultEmailStatus={defaultEmailStatus}
          onDefaultEmailStatusChange={setDefaultEmailStatus}
          defaultSmsStatus={defaultSmsStatus}
          onDefaultSmsStatusChange={setDefaultSmsStatus}
          defaultWhatsappStatus={defaultWhatsappStatus}
          onDefaultWhatsappStatusChange={setDefaultWhatsappStatus}
          tags={tags.data ?? []}
          selectedTagIds={selectedTagIds}
          onSelectedTagsChange={setSelectedTagIds}
          running={startImport.isPending || requestUpload.isPending}
          onBack={() => setStep('map')}
          onRun={() => void run()}
        />
      ) : null}

      {step === 'running' ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Uploading file and queuing import&hellip;
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ===========================================================================
// Step strip
// ===========================================================================

function StepStrip({ step }: { step: Step }): JSX.Element {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'upload', label: 'Upload' },
    { key: 'map', label: 'Map columns' },
    { key: 'review', label: 'Review' },
    { key: 'running', label: 'Run' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-3 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              'grid size-6 place-items-center rounded-full border text-xs font-medium',
              i < currentIndex && 'border-primary bg-primary text-primary-foreground',
              i === currentIndex && 'border-primary text-primary',
              i > currentIndex && 'border-muted text-muted-foreground',
            )}
          >
            {i < currentIndex ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              i === currentIndex ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 ? (
            <span className="h-px w-6 bg-border" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

// ===========================================================================
// Step 1: Upload
// ===========================================================================

function UploadStep({
  onFile,
  error,
}: {
  onFile: (file: File) => void;
  error: string | null;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Choose a CSV file</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center transition-colors hover:bg-muted/50">
          <Upload className="size-7 text-muted-foreground" />
          <span className="text-sm font-medium">
            Click to pick a file <span className="text-muted-foreground">or drop it here</span>
          </span>
          <span className="text-xs text-muted-foreground">
            CSV, up to 50MB. The first row must list column headers.
          </span>
          <Input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Step 2: Map columns
// ===========================================================================

function MapStep({
  preview,
  mapping,
  onMappingChange,
  customFields,
  onBack,
  onNext,
}: {
  preview: PreviewState;
  mapping: Record<string, ImportColumnMapping>;
  onMappingChange: (next: Record<string, ImportColumnMapping>) => void;
  customFields: Array<{ id: string; label: string; key: string; type: string }>;
  onBack: () => void;
  onNext: () => void;
}): JSX.Element {
  const update = (column: string, entry: ImportColumnMapping): void => {
    onMappingChange({ ...mapping, [column]: entry });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Map columns — showing {preview.totalParsedRows} preview row
          {preview.totalParsedRows === 1 ? '' : 's'} of {preview.file.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">CSV column</th>
                <th className="px-3 py-2 font-medium">Sample value</th>
                <th className="px-3 py-2 font-medium">Imports as</th>
              </tr>
            </thead>
            <tbody>
              {preview.headers.map((col) => {
                const sample = preview.rows.find(
                  (r) => r[col] !== undefined && r[col] !== '',
                )?.[col];
                const entry = mapping[col] ?? { kind: 'skip' as const };
                return (
                  <tr key={col} className="border-t">
                    <td className="px-3 py-2 font-medium">{col}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">
                      {sample ?? <span className="italic">empty</span>}
                    </td>
                    <td className="px-3 py-2">
                      <MappingPicker
                        value={entry}
                        customFields={customFields}
                        onChange={(next) => update(col, next)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext}>Continue to review</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Single-column mapping picker. Encodes contact fields + custom fields +
 *  skip as a flat string value so the Select stays simple. */
function MappingPicker({
  value,
  customFields,
  onChange,
}: {
  value: ImportColumnMapping;
  customFields: Array<{ id: string; label: string; key: string; type: string }>;
  onChange: (next: ImportColumnMapping) => void;
}): JSX.Element {
  const currentValue =
    value.kind === 'skip'
      ? '__skip'
      : value.kind === 'field'
        ? `field:${value.field}`
        : `cf:${value.customFieldId}`;

  return (
    <Select
      value={currentValue}
      onValueChange={(v) => {
        if (v === '__skip') {
          onChange({ kind: 'skip' });
        } else if (v.startsWith('field:')) {
          onChange({
            kind: 'field',
            field: v.slice('field:'.length) as ContactField,
          });
        } else if (v.startsWith('cf:')) {
          onChange({ kind: 'custom_field', customFieldId: v.slice('cf:'.length) });
        }
      }}
    >
      <SelectTrigger className="w-[240px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__skip">Skip this column</SelectItem>
        {(['email', 'phone', 'firstName', 'lastName', 'language', 'timezone'] as const).map(
          (f) => (
            <SelectItem key={f} value={`field:${f}`}>
              {CONTACT_FIELD_LABEL[f]}
            </SelectItem>
          ),
        )}
        {customFields.length > 0 ? (
          <div className="my-1 border-t" aria-hidden />
        ) : null}
        {customFields.map((cf) => (
          <SelectItem key={cf.id} value={`cf:${cf.id}`}>
            {cf.label} <span className="text-muted-foreground">({cf.type})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ===========================================================================
// Step 3: Review
// ===========================================================================

function ReviewStep(props: {
  preview: PreviewState;
  mapping: Record<string, ImportColumnMapping>;
  dedupeBy: ImportDedupeStrategyValue;
  onDedupeChange: (v: ImportDedupeStrategyValue) => void;
  defaultEmailStatus: SubscriptionStatusValue;
  onDefaultEmailStatusChange: (v: SubscriptionStatusValue) => void;
  defaultSmsStatus: SubscriptionStatusValue;
  onDefaultSmsStatusChange: (v: SubscriptionStatusValue) => void;
  defaultWhatsappStatus: SubscriptionStatusValue;
  onDefaultWhatsappStatusChange: (v: SubscriptionStatusValue) => void;
  tags: Array<{ id: string; name: string; color: string }>;
  selectedTagIds: string[];
  onSelectedTagsChange: (ids: string[]) => void;
  running: boolean;
  onBack: () => void;
  onRun: () => void;
}): JSX.Element {
  const usedColumns = useMemo(
    () => Object.entries(props.mapping).filter(([, m]) => m.kind !== 'skip'),
    [props.mapping],
  );

  const toggleTag = (id: string): void => {
    if (props.selectedTagIds.includes(id)) {
      props.onSelectedTagsChange(props.selectedTagIds.filter((t) => t !== id));
    } else {
      props.onSelectedTagsChange([...props.selectedTagIds, id]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Review — {props.preview.file.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Columns being imported
          </p>
          <p className="text-sm text-muted-foreground">
            {usedColumns.length} of {props.preview.headers.length} columns mapped,{' '}
            {props.preview.headers.length - usedColumns.length} skipped.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Dedupe strategy
            </label>
            <Select
              value={props.dedupeBy}
              onValueChange={(v) =>
                props.onDedupeChange(v as ImportDedupeStrategyValue)
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EMAIL_OR_PHONE">Match email OR phone</SelectItem>
                <SelectItem value="EMAIL">Match email only</SelectItem>
                <SelectItem value="PHONE">Match phone only</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Existing contacts that match are updated. Otherwise a new contact
              is created.
            </p>
          </div>

          <StatusPicker
            label="Default email status"
            value={props.defaultEmailStatus}
            onChange={props.onDefaultEmailStatusChange}
          />
          <StatusPicker
            label="Default SMS status"
            value={props.defaultSmsStatus}
            onChange={props.onDefaultSmsStatusChange}
          />
          <StatusPicker
            label="Default WhatsApp status"
            value={props.defaultWhatsappStatus}
            onChange={props.onDefaultWhatsappStatusChange}
          />
        </div>

        {props.tags.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tags to apply to every imported contact
            </p>
            <div className="flex flex-wrap gap-1.5">
              {props.tags.map((t) => {
                const active = props.selectedTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={
                      active
                        ? 'inline-flex items-center rounded-full border-2 border-ring'
                        : 'inline-flex items-center rounded-full border-2 border-transparent opacity-60 hover:opacity-100'
                    }
                  >
                    <TagChip tag={t} size="sm" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex justify-between">
          <Button variant="outline" onClick={props.onBack} disabled={props.running}>
            Back
          </Button>
          <Button onClick={props.onRun} disabled={props.running}>
            {props.running ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Starting&hellip;
              </>
            ) : (
              'Start import'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SubscriptionStatusValue;
  onChange: (v: SubscriptionStatusValue) => void;
}): JSX.Element {
  return (
    <div>
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as SubscriptionStatusValue)}>
        <SelectTrigger className="mt-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="SUBSCRIBED">Subscribed</SelectItem>
          <SelectItem value="PENDING">Pending</SelectItem>
          <SelectItem value="UNSUBSCRIBED">Unsubscribed</SelectItem>
          <SelectItem value="BOUNCED">Bounced</SelectItem>
          <SelectItem value="COMPLAINED">Complained</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ===========================================================================
// Auto-match helpers
// ===========================================================================

/**
 * Best-effort header → contact-field matching. We're generous with common
 * CSV conventions (spaces, underscores, lowercasing) but err on the side of
 * leaving columns as "skip" when in doubt — the user can always fix it.
 */
function autoMatchHeaders(
  headers: string[],
): Record<string, ImportColumnMapping> {
  const result: Record<string, ImportColumnMapping> = {};
  const used = new Set<ContactField>();
  for (const header of headers) {
    const normalised = header.toLowerCase().replace(/[\s_-]+/g, '');
    const field = guessContactField(normalised);
    if (field && !used.has(field)) {
      result[header] = { kind: 'field', field };
      used.add(field);
    } else {
      result[header] = { kind: 'skip' };
    }
  }
  return result;
}

function guessContactField(normalised: string): ContactField | null {
  if (normalised === 'email' || normalised === 'emailaddress') return 'email';
  if (normalised === 'phone' || normalised === 'phonenumber' || normalised === 'mobile')
    return 'phone';
  if (
    normalised === 'firstname' ||
    normalised === 'givenname' ||
    normalised === 'fname'
  )
    return 'firstName';
  if (
    normalised === 'lastname' ||
    normalised === 'familyname' ||
    normalised === 'surname' ||
    normalised === 'lname'
  )
    return 'lastName';
  if (normalised === 'language' || normalised === 'locale') return 'language';
  if (normalised === 'timezone' || normalised === 'tz') return 'timezone';
  return null;
}
