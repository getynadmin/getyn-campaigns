'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Loader2,
  Mail,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';

import type {
  CampaignSendStatusValue,
  CampaignStatusValue,
} from '@getyn/types';

import { AbTestSettings } from './ab-test-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const STATUS_TONE: Record<CampaignStatusValue, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  SENDING: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  SENT: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  PAUSED: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  FAILED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  CANCELED: 'bg-muted text-muted-foreground',
};

export function CampaignDetailClient({
  campaignId,
  tenantSlug,
  canEdit,
  canSend,
  tenantPostalAddressMissing,
}: {
  campaignId: string;
  tenantSlug: string;
  canEdit: boolean;
  canSend: boolean;
  tenantPostalAddressMissing: boolean;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const { data: campaign, isLoading } = api.campaign.get.useQuery({
    id: campaignId,
  });
  const recipients = api.campaign.previewRecipients.useQuery(
    { segmentId: campaign?.segmentId ?? '' },
    { enabled: !!campaign?.segmentId },
  );
  const scan = api.campaign.scan.useQuery(
    { id: campaignId },
    { enabled: !!campaign },
  );
  const domains = api.sendingDomain.list.useQuery({ status: 'VERIFIED' });

  const update = api.campaign.update.useMutation({
    onSuccess: () => {
      void utils.campaign.get.invalidate({ id: campaignId });
      void utils.campaign.scan.invalidate({ id: campaignId });
    },
    onError: (err) => toast.error(err.message ?? 'Save failed.'),
  });
  const sendNow = api.campaign.sendNow.useMutation({
    onSuccess: () => {
      toast.success('Campaign queued. The send pipeline takes over.');
      void utils.campaign.get.invalidate({ id: campaignId });
    },
    onError: (err) => toast.error(err.message ?? 'Send failed.'),
  });
  const schedule = api.campaign.schedule.useMutation({
    onSuccess: () => {
      toast.success('Scheduled. The worker fires at the set time.');
      void utils.campaign.get.invalidate({ id: campaignId });
    },
    onError: (err) => toast.error(err.message ?? 'Schedule failed.'),
  });
  const cancel = api.campaign.cancel.useMutation({
    onSuccess: () => {
      toast.success('Canceled.');
      void utils.campaign.get.invalidate({ id: campaignId });
    },
    onError: (err) => toast.error(err.message ?? 'Cancel failed.'),
  });
  const del = api.campaign.delete.useMutation({
    onSuccess: () => {
      toast.success('Draft deleted.');
      router.push(`/t/${tenantSlug}/campaigns`);
    },
    onError: (err) => toast.error(err.message ?? 'Delete failed.'),
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSendNow, setConfirmSendNow] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Campaign not found.</p>
      </div>
    );
  }

  const isDraft = campaign.status === 'DRAFT';
  const ec = campaign.emailCampaign;
  const subject = ec?.subject ?? '(Untitled)';
  const subjectIsStub = subject === '(Untitled)';
  const designSaved = !!ec?.renderedHtml;
  const abTest = ec?.abTest as
    | { enabled?: boolean; variants?: { id: string; subject: string }[] }
    | null
    | undefined;

  const blockingIssues: string[] = [];
  if (subjectIsStub) blockingIssues.push('Set a real subject line.');
  if (!designSaved) blockingIssues.push('Save the email design.');
  if (recipients.data && recipients.data.afterSuppression === 0) {
    blockingIssues.push(
      recipients.data.segmentTotal === 0
        ? 'Segment has no contacts.'
        : 'All segment members are suppressed.',
    );
  }
  if (tenantPostalAddressMissing)
    blockingIssues.push(
      'Add a workspace postal address (Settings → Workspace).',
    );
  if (scan.data?.hasErrors)
    blockingIssues.push('Content scan has errors — review them below.');

  const canActuallySend =
    isDraft &&
    canSend &&
    blockingIssues.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link href={`/t/${tenantSlug}/campaigns`}>
              <ArrowLeft className="mr-2 size-4" />
              All campaigns
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {campaign.name}
            </h1>
            <span
              className={cn(
                'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                STATUS_TONE[campaign.status as CampaignStatusValue],
              )}
            >
              {campaign.status}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isDraft && campaign.status === 'SENT' ? (
            <Button asChild variant="outline">
              <Link
                href={`/t/${tenantSlug}/campaigns/${campaign.id}/analytics`}
              >
                View analytics
              </Link>
            </Button>
          ) : null}
          {isDraft && canEdit ? (
            <Button asChild variant="outline">
              <Link
                href={`/t/${tenantSlug}/campaigns/${campaign.id}/design`}
              >
                <Pencil className="mr-2 size-4" />
                Open editor
              </Link>
            </Button>
          ) : null}
          {isDraft && canSend ? (
            <>
              <Button
                onClick={() => setConfirmSendNow(true)}
                disabled={!canActuallySend || sendNow.isPending}
              >
                <Send className="mr-2 size-4" />
                Send now
              </Button>
            </>
          ) : null}
          {campaign.status === 'SCHEDULED' && canSend ? (
            <Button
              variant="outline"
              onClick={() => cancel.mutate({ id: campaign.id })}
              disabled={cancel.isPending}
            >
              Cancel send
            </Button>
          ) : null}
        </div>
      </div>

      {blockingIssues.length > 0 && isDraft ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Pre-flight checks not yet passing
              </p>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-800 dark:text-amber-200">
                {blockingIssues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {/* RECIPIENTS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Recipients
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div>
              Segment{' '}
              <span className="font-medium">
                {campaign.segment?.name ?? '—'}
              </span>
            </div>
            {recipients.data ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>·</span>
                <span>
                  <span className="font-medium text-foreground">
                    {recipients.data.afterSuppression.toLocaleString()}
                  </span>{' '}
                  will receive
                  {recipients.data.afterSuppression !==
                  recipients.data.segmentTotal ? (
                    <>
                      {' '}
                      ({recipients.data.segmentTotal.toLocaleString()} in
                      segment, minus{' '}
                      {(
                        recipients.data.segmentTotal -
                        recipients.data.afterSuppression
                      ).toLocaleString()}{' '}
                      suppressed)
                    </>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* DESIGN */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4" />
            Design
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              {designSaved ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Saved · {ec?.renderedHtml?.length.toLocaleString()} bytes
                </>
              ) : (
                <>
                  <XCircle className="size-4 text-amber-600" />
                  Design not yet saved
                </>
              )}
            </div>
            {isDraft && canEdit ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/t/${tenantSlug}/campaigns/${campaign.id}/design`}
                >
                  {designSaved ? 'Edit design' : 'Open editor'}
                </Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* SETTINGS — inline editable for DRAFT */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isDraft && canEdit ? (
            <SettingsEditor
              campaignId={campaign.id}
              ec={
                ec
                  ? {
                      subject: ec.subject,
                      previewText: ec.previewText,
                      fromName: ec.fromName,
                      fromEmail: ec.fromEmail,
                      replyTo: ec.replyTo,
                      sendingDomainId: ec.sendingDomainId,
                    }
                  : null
              }
              domains={domains.data?.items ?? []}
              onSaveStart={() => undefined}
              onSaved={() =>
                update.isSuccess
                  ? void utils.campaign.get.invalidate({ id: campaignId })
                  : undefined
              }
              update={(patch) =>
                update.mutateAsync({
                  id: campaign.id,
                  patch: { settings: patch },
                })
              }
            />
          ) : (
            <ReadOnlySettings ec={ec} />
          )}

          <hr className="-mx-6" />

          {ec ? (
            <AbTestSettings
              campaignId={campaign.id}
              currentAbTest={
                abTest && abTest.enabled === true
                  ? (ec.abTest as Parameters<
                      typeof AbTestSettings
                    >[0]['currentAbTest'])
                  : null
              }
              fallbackSubject={ec.subject}
              canEdit={isDraft && canEdit}
              onChange={() =>
                void utils.campaign.get.invalidate({ id: campaignId })
              }
            />
          ) : null}
        </CardContent>
      </Card>

      {/* SCHEDULING — only when DRAFT */}
      {isDraft && canSend ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="size-4" />
              Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <Label htmlFor="scheduleAt" className="text-xs">
                  Send at (your timezone)
                </Label>
                <Input
                  id="scheduleAt"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                disabled={
                  !scheduleAt || !canActuallySend || schedule.isPending
                }
                onClick={() => {
                  schedule.mutate({
                    id: campaign.id,
                    scheduledAt: new Date(scheduleAt).toISOString(),
                  });
                }}
              >
                Schedule
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Or click <span className="font-medium">Send now</span> at the
              top of the page to skip scheduling.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* CONTENT SCAN */}
      {scan.data && scan.data.issues.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content review</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {scan.data.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2">
                  {issue.level === 'error' ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  )}
                  <span
                    className={
                      issue.level === 'error'
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-amber-800 dark:text-amber-200'
                    }
                  >
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* DELETE — DRAFT only */}
      {isDraft && canSend ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-2 size-3.5" />
            Delete draft
          </Button>
        </div>
      ) : null}

      {/* Confirm send */}
      <Dialog open={confirmSendNow} onOpenChange={setConfirmSendNow}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this campaign now?</DialogTitle>
            <DialogDescription>
              {recipients.data?.afterSuppression.toLocaleString()} recipients
              after the suppression filter. The send pipeline takes over —
              once queued, this can't be canceled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSendNow(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={sendNow.isPending}
              onClick={() => {
                sendNow.mutate({ id: campaign.id });
                setConfirmSendNow(false);
              }}
            >
              {sendNow.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              The draft and its design data are removed. Cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                del.mutate({ id: campaign.id });
                setConfirmDelete(false);
              }}
              disabled={del.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsEditor({
  ec,
  domains,
  update,
}: {
  campaignId: string;
  ec: {
    subject: string;
    previewText: string | null;
    fromName: string;
    fromEmail: string;
    replyTo: string | null;
    sendingDomainId: string | null;
  } | null;
  domains: { id: string; domain: string }[];
  onSaveStart: () => void;
  onSaved: () => void;
  update: (patch: {
    subject?: string;
    previewText?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    sendingDomainId?: string | null;
  }) => Promise<unknown>;
}): JSX.Element {
  const [subject, setSubject] = useState(ec?.subject === '(Untitled)' ? '' : ec?.subject ?? '');
  const [previewText, setPreviewText] = useState(ec?.previewText ?? '');
  const [fromName, setFromName] = useState(ec?.fromName ?? '');
  const [fromEmail, setFromEmail] = useState(ec?.fromEmail ?? '');
  const [replyTo, setReplyTo] = useState(ec?.replyTo ?? '');
  const [sendingDomainId, setSendingDomainId] = useState(
    ec?.sendingDomainId ?? '',
  );

  const save = async (): Promise<void> => {
    await update({
      subject: subject || undefined,
      previewText: previewText || undefined,
      fromName: fromName || undefined,
      fromEmail: fromEmail || undefined,
      replyTo: replyTo || undefined,
      sendingDomainId: sendingDomainId || null,
    });
    toast.success('Saved.');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input
            value={subject}
            onBlur={save}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="A subject your recipients see"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Preview text (optional)</Label>
          <Input
            value={previewText}
            onBlur={save}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="Snippet shown after the subject in inboxes"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From name</Label>
          <Input
            value={fromName}
            onBlur={save}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From email</Label>
          <Input
            value={fromEmail}
            onBlur={save}
            onChange={(e) => setFromEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reply-to (optional)</Label>
          <Input
            value={replyTo}
            onBlur={save}
            onChange={(e) => setReplyTo(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sending domain</Label>
          <Select
            value={sendingDomainId || 'shared'}
            onValueChange={(v) => {
              const next = v === 'shared' ? '' : v;
              setSendingDomainId(next);
              void update({ sendingDomainId: next || null });
              toast.success('Saved.');
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shared">Shared @getynmail.com</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.domain}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function ReadOnlySettings({
  ec,
}: {
  ec: {
    subject: string;
    previewText: string | null;
    fromName: string;
    fromEmail: string;
    replyTo: string | null;
  } | null;
}): JSX.Element {
  if (!ec) return <p className="text-sm text-muted-foreground">No settings.</p>;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <Field label="Subject" value={ec.subject} />
      <Field label="Preview text" value={ec.previewText ?? '—'} />
      <Field label="From" value={`${ec.fromName} <${ec.fromEmail}>`} />
      <Field label="Reply-to" value={ec.replyTo ?? '—'} />
    </dl>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

// Suppress import-only-as-type warnings.
void ({} as CampaignSendStatusValue);
