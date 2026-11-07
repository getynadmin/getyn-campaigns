'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

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
import { api } from '@/lib/trpc';

type Props = {
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Proposal = NonNullable<
  ReturnType<typeof api.ai.composeCampaign.useMutation>['data']
>['proposal'];

/**
 * Campaign Composer — operator describes a goal, Claude returns a
 * proposed campaign (segment choice, name, subject, preview, from
 * name, body). Operator can edit any field before clicking "Create
 * draft", which creates a DRAFT campaign and redirects to the design
 * editor to finish. The generated body shows as a "copy this into
 * your design" block in the same modal.
 */
export function CampaignComposeDialog({
  tenantSlug,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [proposal, setProposal] = useState<Proposal>(null);
  // Editable overrides on top of the AI proposal. We don't mutate the
  // proposal object so the user can "reset" by regenerating.
  const [edits, setEdits] = useState<{
    name?: string;
    subject?: string;
    previewText?: string;
    fromName?: string;
    segmentId?: string;
  }>({});

  const segments = api.segments.list.useQuery(
    { limit: 50 },
    { enabled: open },
  );
  const sendingDomains = api.sendingDomain.list.useQuery(
    { limit: 50 },
    { enabled: open },
  );

  const compose = api.ai.composeCampaign.useMutation({
    onSuccess: (res) => {
      if (res.proposal) {
        setProposal(res.proposal);
        setEdits({});
        toast.success('Draft composed. Review before creating.');
      } else {
        toast.error(
          res.issues[0]?.message ?? 'Could not compose a draft. Try again.',
        );
      }
    },
    onError: (err) => toast.error(err.message || 'Could not compose a draft.'),
  });

  const createCampaign = api.campaign.create.useMutation({
    onSuccess: (campaign) => {
      toast.success('Draft campaign created.');
      onOpenChange(false);
      router.push(`/t/${tenantSlug}/campaigns/${campaign.id}/design`);
    },
    onError: (err) => toast.error(err.message || 'Could not create draft.'),
  });

  const effective = proposal
    ? {
        name: edits.name ?? proposal.name,
        subject: edits.subject ?? proposal.subject,
        previewText: edits.previewText ?? proposal.previewText,
        fromName: edits.fromName ?? proposal.fromName,
        segmentId: edits.segmentId ?? proposal.suggestedSegmentId ?? '',
      }
    : null;

  const verifiedDomain = (sendingDomains.data?.items ?? []).find(
    (d) => d.status === 'VERIFIED',
  );
  const defaultFromEmail = verifiedDomain
    ? `hello@${verifiedDomain.domain}`
    : '';

  const canCreate =
    !!proposal &&
    !!effective?.segmentId &&
    !!effective.name.trim() &&
    !!effective.subject.trim() &&
    !!effective.fromName.trim() &&
    !!defaultFromEmail &&
    !createCampaign.isPending;

  const onCreate = (): void => {
    if (!proposal || !effective) return;
    if (!defaultFromEmail) {
      toast.error(
        'Add a verified sending domain in Settings → Sending before using the composer.',
      );
      return;
    }
    createCampaign.mutate({
      name: effective.name.trim(),
      type: 'EMAIL',
      segmentId: effective.segmentId,
      settings: {
        subject: effective.subject.trim(),
        previewText: effective.previewText?.trim() || undefined,
        fromName: effective.fromName.trim(),
        fromEmail: defaultFromEmail,
        trackingEnabled: true,
      },
      designJson: {},
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-violet-500" />
            Compose with AI
          </DialogTitle>
          <DialogDescription>
            Describe what you want to send. Getyn AI picks a segment, drafts
            the subject + body, and seeds a draft you can finish in the
            designer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Campaign goal
            </label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              maxLength={1500}
              placeholder='e.g. "Re-engage SkillCertified GCC leads who signed up in 2024. Drive to /pricing."'
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                disabled={compose.isPending || goal.trim().length < 10}
                onClick={() => compose.mutate({ goal: goal.trim() })}
              >
                {compose.isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-4" />
                )}
                {proposal ? 'Regenerate' : 'Compose'}
              </Button>
            </div>
          </div>

          {proposal && effective ? (
            <div className="space-y-3 border-t pt-4">
              <p className="rounded-md border border-violet-500/30 bg-violet-50/40 px-3 py-2 text-xs text-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
                {proposal.rationale || 'Review and tweak before creating.'}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Campaign name
                  </label>
                  <Input
                    value={effective.name}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, name: e.target.value }))
                    }
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Segment
                  </label>
                  <select
                    value={effective.segmentId}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, segmentId: e.target.value }))
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">— pick a segment —</option>
                    {(segments.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {typeof s.cachedCount === 'number'
                          ? ` (${s.cachedCount})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Subject
                </label>
                <Input
                  value={effective.subject}
                  onChange={(e) =>
                    setEdits((p) => ({ ...p, subject: e.target.value }))
                  }
                  maxLength={200}
                />
                {proposal.subjectVariants.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">Try:</span>
                    {proposal.subjectVariants.map((v, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setEdits((p) => ({ ...p, subject: v }))}
                        className="rounded-full border border-border bg-muted/40 px-2 py-0.5 hover:bg-muted"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Preview text
                  </label>
                  <Input
                    value={effective.previewText}
                    onChange={(e) =>
                      setEdits((p) => ({
                        ...p,
                        previewText: e.target.value,
                      }))
                    }
                    maxLength={150}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    From name
                  </label>
                  <Input
                    value={effective.fromName}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, fromName: e.target.value }))
                    }
                    maxLength={80}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Body copy — paste into the designer after creating
                </label>
                <textarea
                  value={proposal.bodyText}
                  readOnly
                  rows={6}
                  className="flex w-full rounded-md border border-input bg-muted/30 px-3 py-2 text-xs ring-offset-background"
                />
                <div className="flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(proposal.bodyText);
                      toast.success('Body copied.');
                    }}
                  >
                    Copy body
                  </Button>
                </div>
              </div>

              {!defaultFromEmail ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-50/40 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  No verified sending domain found. Add one in Settings →
                  Sending before creating the draft.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createCampaign.isPending}
          >
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={!canCreate}>
            {createCampaign.isPending ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : null}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
