'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import type { AutomationDefinition } from '@getyn/types';

/**
 * Floating bottom-center AI assistant for the drip builder.
 *
 * Small, unobtrusive by default (an icon-only pill). Expands into a
 * textarea + generate button when clicked. Generates a full
 * AutomationDefinition via automation.generateFromPrompt and hands it
 * back to the builder to apply through the normal update-definition
 * path (so autosave semantics stay consistent).
 *
 * If the canvas has more than trigger+exit, opens a confirm dialog
 * before replacing.
 */
export function AiAssistantBar({
  currentDefinition,
  onApply,
}: {
  currentDefinition: AutomationDefinition;
  onApply: (next: AutomationDefinition) => void;
}): JSX.Element | null {
  const availability = api.automation.aiIsAvailable.useQuery();
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState<AutomationDefinition | null>(null);

  const generate = api.automation.generateFromPrompt.useMutation({
    onSuccess: (data) => {
      // Non-empty canvas => confirm before replacing.
      const hasContent =
        currentDefinition.nodes.length > 2 || currentDefinition.edges.length > 1;
      if (hasContent) {
        setPending(data.definition);
      } else {
        applyAndReset(data.definition);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  function applyAndReset(next: AutomationDefinition): void {
    onApply(next);
    toast.success('Workflow generated. Review each node before activating.');
    setPrompt('');
    setExpanded(false);
    setPending(null);
  }

  if (availability.data && !availability.data.available) {
    // No Anthropic key configured — hide the bar entirely rather
    // than render a dead button.
    return null;
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 shadow-lg backdrop-blur transition-all',
            expanded ? 'w-full max-w-2xl px-3 py-2' : 'px-3 py-1.5',
          )}
        >
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Sparkles className="size-4 text-violet-600" />
              Ask AI to draft this workflow
            </button>
          ) : (
            <>
              <Sparkles className="size-4 shrink-0 text-violet-600" />
              <textarea
                autoFocus
                rows={1}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setExpanded(false);
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    if (prompt.trim().length >= 4) {
                      generate.mutate({ prompt: prompt.trim(), replace: true });
                    }
                    e.preventDefault();
                  }
                }}
                placeholder="e.g. Welcome series: 3 emails over 10 days introducing our product to new signups, ending with a call-booking ask"
                className="min-h-0 flex-1 resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
                maxLength={4000}
              />
              <Button
                size="sm"
                onClick={() =>
                  generate.mutate({ prompt: prompt.trim(), replace: true })
                }
                disabled={generate.isPending || prompt.trim().length < 4}
              >
                {generate.isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-1 size-4" />
                )}
                Generate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setExpanded(false);
                  setPrompt('');
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace current workflow?</DialogTitle>
            <DialogDescription>
              You have {currentDefinition.nodes.length} nodes on the canvas. The
              generated workflow will replace everything. Message nodes land as
              Draft — flip each to Live after review.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep current
            </Button>
            <Button
              onClick={() => {
                if (pending) applyAndReset(pending);
              }}
            >
              Replace with AI draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
