'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { AiButton } from '@/components/ui/ai-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/trpc';

/**
 * Brief → ai.generateEmailTemplate → saved tenant template +
 * redirect into the designer. Lifted out of the library tab so it
 * lives behind the gradient AI button like the Campaigns composer.
 */
export function AiGenerateTemplateDialog({
  tenantSlug,
  open,
  onOpenChange,
}: {
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const [brief, setBrief] = useState('');

  const generate = api.ai.generateEmailTemplate.useMutation({
    onSuccess: (res) => {
      toast.success('Template created. Opening editor…');
      void utils.emailTemplate.list.invalidate();
      onOpenChange(false);
      setBrief('');
      router.push(`/t/${tenantSlug}/templates/${res.template.id}/design`);
    },
    onError: (err) => toast.error(err.message ?? 'Could not generate.'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-violet-500" />
            Generate with AI
          </DialogTitle>
          <DialogDescription>
            Describe the email — Getyn AI writes the subject, copy and HTML
            design, then saves it to{' '}
            <span className="font-medium">My templates</span> with an AI
            badge.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={5}
          maxLength={1500}
          placeholder='e.g. "Welcome email for new Getyn signups — warm tone, a hero heading, a single CTA to the dashboard."'
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={generate.isPending}
          >
            Cancel
          </Button>
          <AiButton
            disabled={generate.isPending || brief.trim().length < 10}
            onClick={() => generate.mutate({ brief: brief.trim() })}
          >
            {generate.isPending ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : null}
            Generate template
          </AiButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
