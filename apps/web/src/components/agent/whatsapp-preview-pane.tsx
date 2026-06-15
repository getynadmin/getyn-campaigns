'use client';

import { Phone } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

/**
 * Phase 7 M5 — WhatsApp preview pane.
 *
 * Phone-frame mockup of the picked template with variable values
 * substituted using sample data. Reads the conversation state via
 * tRPC; the parent invalidates after each turn so the preview
 * updates as the agent picks/drafts a template + fills variables.
 *
 * Variable values that are merge tags ("contact.firstName") render
 * as placeholder pills rather than concrete strings — the user
 * understands those resolve per-recipient at send time.
 */
export function WhatsAppPreviewPane({
  conversationId,
}: {
  conversationId: string;
}): JSX.Element {
  const { data, isLoading } = api.agent.getConversation.useQuery({
    id: conversationId,
  });
  if (isLoading || !data) {
    return (
      <div className="grid h-full place-items-center">
        <Skeleton className="h-3/4 w-64" />
      </div>
    );
  }
  const state = (data.conversationState as Record<string, unknown>) ?? {};
  const template = state.template as
    | {
        templateName: string;
        bodyText: string;
        variableCount: number;
        status: string;
      }
    | undefined;
  const variables =
    (state.templateVariables as
      | Array<{ type: 'static' | 'merge'; value: string }>
      | undefined) ?? [];
  const phoneNumber = state.phoneNumber as
    | { phoneNumber: string; verifiedName: string }
    | undefined;

  if (!template) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          <p className="font-medium">No template picked yet</p>
          <p className="mt-1 text-xs">
            Pick or draft a template — the preview will appear here.
          </p>
        </div>
      </div>
    );
  }

  const rendered = renderTemplate(template.bodyText, variables);

  return (
    <div className="flex h-full flex-col items-center overflow-auto p-6">
      <div className="mx-auto w-full max-w-[330px]">
        {/* Phone frame */}
        <div className="overflow-hidden rounded-[2.5rem] border-8 border-zinc-800 bg-[#0a1612] shadow-2xl">
          {/* Status bar */}
          <div className="flex h-7 items-center justify-between bg-[#0a1612] px-4 text-[10px] text-zinc-300">
            <span>9:41</span>
            <span>{phoneNumber?.verifiedName ?? 'Your brand'}</span>
            <span>•••</span>
          </div>
          {/* Conversation header */}
          <div className="flex items-center gap-2 border-b border-zinc-700 bg-[#1f2c34] px-3 py-2">
            <span className="grid size-9 place-items-center rounded-full bg-emerald-700 text-white">
              <Phone className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {phoneNumber?.verifiedName ?? 'Your brand'}
              </p>
              <p className="truncate text-[10px] text-zinc-400">
                {phoneNumber?.phoneNumber ?? '+ —'}
              </p>
            </div>
          </div>
          {/* Chat area */}
          <div className="min-h-[420px] space-y-2 bg-[#0b141a] p-3">
            <div className="ml-4 rounded-lg bg-[#005c4b] px-3 py-2 text-sm text-white shadow-sm">
              <div className="whitespace-pre-wrap break-words">{rendered}</div>
              <div className="mt-1 text-right text-[10px] text-emerald-100/70">
                {timeNow()} ✓✓
              </div>
            </div>
          </div>
        </div>
        {/* Template meta */}
        <div className="mt-3 rounded-md border bg-card px-3 py-2 text-xs">
          <p className="font-medium">
            <code className="font-mono text-[11px]">
              {template.templateName}
            </code>
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Status:{' '}
            <span
              className={
                template.status === 'APPROVED'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300'
              }
            >
              {template.status}
            </span>{' '}
            · {variables.length}/{template.variableCount} variables filled
          </p>
        </div>
      </div>
    </div>
  );
}

function timeNow(): string {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderTemplate(
  body: string,
  vars: Array<{ type: 'static' | 'merge'; value: string }>,
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (match, num: string) => {
    const idx = Number(num) - 1;
    const v = vars[idx];
    if (!v) return match;
    if (v.type === 'static') return v.value;
    // Merge tag — show as pill-ish placeholder so it's clear it
    // resolves at send time.
    return `「${v.value}」`;
  });
}
