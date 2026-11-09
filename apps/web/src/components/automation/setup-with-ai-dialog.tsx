'use client';

import { useState } from 'react';
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
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { api } from '@/lib/trpc';

/**
 * Shared "Set up with AI" dialog for both the Email Agent and
 * WhatsApp Agent wizards. Operator types or dictates a short brief;
 * the mutation returns `{ persona, goal }` which the parent writes
 * into its own form state. Everything else (knowledge, schedule,
 * templates, review) stays the operator's job.
 */
export function SetupWithAiDialog({
  open,
  onOpenChange,
  channel,
  onDrafted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: 'email' | 'whatsapp';
  onDrafted: (draft: { persona: string; goal: string }) => void;
}): JSX.Element {
  const [brief, setBrief] = useState('');
  const [interim, setInterim] = useState('');

  const mutation = api.ai.setupAgent.useMutation({
    onSuccess: (res) => {
      toast.success('Persona + goal drafted. Review and continue.');
      onDrafted({ persona: res.persona, goal: res.goal });
      onOpenChange(false);
      setBrief('');
      setInterim('');
    },
    onError: (err) => toast.error(err.message ?? 'Could not draft.'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-violet-500" />
            Set up with AI
          </DialogTitle>
          <DialogDescription>
            Describe what the agent should do in a sentence or two — Getyn AI
            will draft the Persona + Goal fields. You fill in knowledge,
            schedule and templates after.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <textarea
            value={brief + interim}
            onChange={(e) => {
              setInterim('');
              setBrief(e.target.value);
            }}
            rows={5}
            maxLength={1500}
            placeholder={
              channel === 'whatsapp'
                ? 'e.g. "An agent that answers pricing questions on WhatsApp and books demos — warm, short messages."'
                : 'e.g. "An agent that replies to inbound support emails about billing — calm, helpful, offers to escalate to a human if unresolved in 2 turns."'
            }
            className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 pr-11 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <VoiceInputButton
            className="absolute bottom-2 right-2"
            onInterim={setInterim}
            onFinal={(chunk) => setBrief((prev) => prev + chunk)}
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <AiButton
            disabled={mutation.isPending || brief.trim().length < 10}
            onClick={() =>
              mutation.mutate({ channel, brief: brief.trim() })
            }
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : null}
            Draft persona + goal
          </AiButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
