'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

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
import { api } from '@/lib/trpc';

/**
 * Workflow-level settings modal — sender identity + onReply policy.
 *
 * Sender fields are required before the tenant can activate any
 * automation that contains an Email node; the server enforces this
 * on the activate mutation. Domain dropdown is populated from
 * verified SendingDomains only.
 */
export function WorkflowSettingsDialog({
  open,
  onOpenChange,
  automationId,
  automationStatus,
  initialSettings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  automationId: string;
  initialSettings: {
    onReply?: 'STOP' | 'CONTINUE' | 'BRANCH';
    fromName?: string | null;
    fromEmail?: string | null;
    targetSegmentId?: string | null;
  };
  automationStatus: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}): JSX.Element {
  const utils = api.useUtils();
  const domains = api.automation.sendingDomainOptions.useQuery(undefined, {
    enabled: open,
  });
  const segments = api.automation.segmentOptions.useQuery(undefined, {
    enabled: open,
  });

  const [onReply, setOnReply] = useState<'STOP' | 'CONTINUE' | 'BRANCH'>(
    initialSettings.onReply ?? 'STOP',
  );
  const [fromName, setFromName] = useState<string>(initialSettings.fromName ?? '');
  const [fromEmail, setFromEmail] = useState<string>(initialSettings.fromEmail ?? '');
  const [targetSegmentId, setTargetSegmentId] = useState<string | null>(
    initialSettings.targetSegmentId ?? null,
  );

  // Hydrate again on re-open so we always show what's actually saved.
  useEffect(() => {
    if (open) {
      setOnReply(initialSettings.onReply ?? 'STOP');
      setFromName(initialSettings.fromName ?? '');
      setFromEmail(initialSettings.fromEmail ?? '');
      setTargetSegmentId(initialSettings.targetSegmentId ?? null);
    }
  }, [open, initialSettings]);

  const localPart = fromEmail.split('@')[0] ?? '';
  const domainPart = fromEmail.includes('@')
    ? fromEmail.split('@')[1]!
    : (domains.data?.[0] ?? '');

  const save = api.automation.updateSettings.useMutation({
    onSuccess: () => {
      toast.success('Workflow settings saved.');
      void utils.automation.get.invalidate({ id: automationId });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const resetEnrollments = api.automation.resetEnrollments.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Deleted ${data.deleted.toLocaleString()} enrollment${data.deleted === 1 ? '' : 's'}. You can now re-enroll.`,
      );
      void utils.automation.stats.invalidate({ id: automationId });
      void utils.automation.get.invalidate({ id: automationId });
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkEnroll = api.automation.enrollFromSegment.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Enrolled ${data.enrolled.toLocaleString()} contact${data.enrolled === 1 ? '' : 's'}` +
          (data.skipped > 0
            ? ` · skipped ${data.skipped.toLocaleString()} already active`
            : ''),
      );
      void utils.automation.stats.invalidate({ id: automationId });
      void utils.automation.get.invalidate({ id: automationId });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Workflow settings</DialogTitle>
          <DialogDescription>
            Applies to every Email node in this automation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">From name</Label>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Sarah at Skillcertified"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From email — local part</Label>
              <Input
                value={localPart}
                onChange={(e) =>
                  setFromEmail(`${e.target.value}@${domainPart}`)
                }
                placeholder="sarah"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sending domain</Label>
              <Select
                value={domainPart}
                onValueChange={(v) => setFromEmail(`${localPart}@${v}`)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a domain…" />
                </SelectTrigger>
                <SelectContent>
                  {(domains.data ?? []).length === 0 ? (
                    <SelectItem value="none" disabled>
                      No verified domains — add one under Settings → Sending domains.
                    </SelectItem>
                  ) : (
                    domains.data!.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">When a contact replies</Label>
            <Select
              value={onReply}
              onValueChange={(v) => setOnReply(v as typeof onReply)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STOP">Stop the automation for that contact</SelectItem>
                <SelectItem value="CONTINUE">Continue anyway</SelectItem>
                <SelectItem value="BRANCH">Route via a Reply split node (advanced)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 rounded-md border bg-muted/30 p-3">
            <Label className="text-xs">Target audience</Label>
            <Select
              value={targetSegmentId ?? 'none'}
              onValueChange={(v) =>
                setTargetSegmentId(v === 'none' ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a segment…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  No segment (manual enrollment only)
                </SelectItem>
                {(segments.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.cachedCount !== null
                      ? ` (${s.cachedCount.toLocaleString()})`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Marks the intended audience for this workflow. Use the button
              below to enrol every matching contact — active enrollments are
              skipped, quota is enforced.
            </p>
            {targetSegmentId && automationStatus === 'ACTIVE' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 w-full"
                disabled={bulkEnroll.isPending}
                onClick={() =>
                  bulkEnroll.mutate({
                    automationId,
                    segmentId: targetSegmentId,
                  })
                }
              >
                {bulkEnroll.isPending && (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                )}
                Enrol all matching contacts now
              </Button>
            )}
            {targetSegmentId && automationStatus !== 'ACTIVE' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Activate the workflow before enrolling contacts.
              </p>
            )}
          </div>

          <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <span className="font-medium">Reply-To:</span> replies route back through{' '}
            <code>reply.getyn.com</code> so we can match them to this workflow. No
            extra configuration needed.
          </p>

          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div>
              <p className="text-xs font-medium text-destructive">Danger zone</p>
              <p className="text-[11px] text-muted-foreground">
                Delete every enrollment for this workflow (queued, waiting,
                sent, failed). Use when a bad configuration left contacts
                stuck and you want a clean re-run. Contacts stay in your
                audience; you can re-enrol them afterwards.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (
                  !window.confirm(
                    'Delete all enrollments for this workflow? This cannot be undone.',
                  )
                )
                  return;
                resetEnrollments.mutate({ id: automationId });
              }}
              disabled={resetEnrollments.isPending}
            >
              {resetEnrollments.isPending && (
                <Loader2 className="mr-1 size-4 animate-spin" />
              )}
              Reset all enrollments
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              save.mutate({
                id: automationId,
                settings: {
                  onReply,
                  fromName: fromName.trim() || null,
                  fromEmail: fromEmail.trim().toLowerCase() || null,
                  targetSegmentId,
                },
              })
            }
            disabled={save.isPending}
          >
            {save.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
