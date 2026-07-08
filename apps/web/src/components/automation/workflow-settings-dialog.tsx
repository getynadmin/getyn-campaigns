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
  initialSettings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  automationId: string;
  initialSettings: {
    onReply?: 'STOP' | 'CONTINUE' | 'BRANCH';
    fromName?: string | null;
    fromEmail?: string | null;
  };
}): JSX.Element {
  const utils = api.useUtils();
  const domains = api.automation.sendingDomainOptions.useQuery(undefined, {
    enabled: open,
  });

  const [onReply, setOnReply] = useState<'STOP' | 'CONTINUE' | 'BRANCH'>(
    initialSettings.onReply ?? 'STOP',
  );
  const [fromName, setFromName] = useState<string>(initialSettings.fromName ?? '');
  const [fromEmail, setFromEmail] = useState<string>(initialSettings.fromEmail ?? '');

  // Hydrate again on re-open so we always show what's actually saved.
  useEffect(() => {
    if (open) {
      setOnReply(initialSettings.onReply ?? 'STOP');
      setFromName(initialSettings.fromName ?? '');
      setFromEmail(initialSettings.fromEmail ?? '');
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

          <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <span className="font-medium">Reply-To:</span> replies route back through{' '}
            <code>reply.getyn.com</code> so we can match them to this workflow. No
            extra configuration needed.
          </p>
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
