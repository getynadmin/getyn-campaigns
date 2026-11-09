'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Sparkles } from 'lucide-react';
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
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const mutation = api.ai.setupAgent.useMutation({
    onSuccess: (res) => {
      toast.success('Persona + goal drafted. Review and continue.');
      onDrafted({ persona: res.persona, goal: res.goal });
      onOpenChange(false);
      setBrief('');
    },
    onError: (err) => toast.error(err.message ?? 'Could not draft.'),
  });

  // Clean up any active recognition when the dialog closes.
  useEffect(() => {
    if (!open) {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
      setListening(false);
    }
  }, [open]);

  const supportsSpeech =
    typeof window !== 'undefined' &&
    (Boolean((window as WindowWithSpeech).SpeechRecognition) ||
      Boolean((window as WindowWithSpeech).webkitSpeechRecognition));

  const toggleMic = (): void => {
    if (!supportsSpeech) {
      toast.error('Your browser does not support voice dictation.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r || !r.isFinal) continue;
        const transcript = r[0]?.transcript ?? '';
        setBrief((prev) =>
          prev ? `${prev.trim()} ${transcript}`.trim() : transcript,
        );
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      toast.error('Voice dictation failed. Try typing instead.');
    };
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

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
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            maxLength={1500}
            placeholder={
              channel === 'whatsapp'
                ? 'e.g. "An agent that answers pricing questions on WhatsApp and books demos — warm, short messages."'
                : 'e.g. "An agent that replies to inbound support emails about billing — calm, helpful, offers to escalate to a human if unresolved in 2 turns."'
            }
            className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 pr-11 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={toggleMic}
            disabled={!supportsSpeech}
            title={
              supportsSpeech
                ? listening
                  ? 'Stop dictation'
                  : 'Dictate with microphone'
                : 'Voice dictation not supported in this browser'
            }
            className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-md border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {listening ? (
              <MicOff className="size-4 text-rose-500" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
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

// Minimal typings — the Web Speech API is not in lib.dom.d.ts in every
// TS target we support. Keeps us from pulling @types/dom-speech-recognition
// as a dep for this one file.
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
    [index: number]: { transcript: string };
  }>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};
