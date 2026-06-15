'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentStream } from './use-agent-stream';
import { EmailPreviewPane } from './email-preview-pane';
import { WhatsAppPreviewPane } from './whatsapp-preview-pane';
import { api } from '@/lib/trpc';

/**
 * Phase 7 M5 — main agent chat UI.
 *
 * Desktop: 40/60 split (chat / preview). Mobile: tabs.
 *
 * Message list rebuilds from server-persisted AgentMessage on every
 * mount + after each turn, so resume + cross-device works. While a
 * turn is streaming, the latest assistant text + tool-call pills
 * render from the SSE buffer.
 */
type Channel = 'EMAIL' | 'WHATSAPP';

const AGENT_LABELS: Record<Channel, { name: string; icon: typeof Mail }> = {
  EMAIL: { name: 'Email Campaign Assistant', icon: Mail },
  WHATSAPP: { name: 'WhatsApp Campaign Assistant', icon: MessageCircle },
};

export function AgentChatClient({
  conversationId,
  tenantSlug,
}: {
  conversationId: string;
  tenantSlug: string;
}): JSX.Element {
  const utils = api.useUtils();
  const convoQ = api.agent.getConversation.useQuery({ id: conversationId });
  const abandon = api.agent.abandonConversation.useMutation({
    onSuccess: () => {
      toast.success('Conversation abandoned.');
      window.location.href = `/t/${tenantSlug}/agent`;
    },
    onError: (err) => toast.error(err.message),
  });
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pane, setPane] = useState<'chat' | 'preview'>('chat');

  const stream = useAgentStream({
    conversationId,
    onTurnComplete: () => {
      void utils.agent.getConversation.invalidate({ id: conversationId });
      void utils.agent.renderEmailPreview.invalidate({ conversationId });
    },
  });

  // Auto-redirect on finalize.
  useEffect(() => {
    if (stream.finalizedRedirectTo) {
      // small delay so the celebratory state is visible
      const t = setTimeout(() => {
        window.location.href = stream.finalizedRedirectTo!;
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [stream.finalizedRedirectTo]);

  if (convoQ.isLoading || !convoQ.data) {
    return <Skeleton className="h-screen" />;
  }
  const convo = convoQ.data;
  const channel = convo.channel as Channel;
  const { name, icon: Icon } = AGENT_LABELS[channel];

  const isFinalized = convo.status === 'COMPLETED_DRAFT_CREATED';
  const isAbandoned = convo.status === 'ABANDONED';

  const handleSend = () => {
    const text = input.trim();
    if (!text || stream.status === 'streaming') return;
    setInput('');
    void stream.send(text);
  };

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b bg-background px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid size-9 place-items-center rounded-md bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-sm">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-[11px] text-muted-foreground">
              <Icon className="mr-1 inline size-3" />
              {channel === 'EMAIL' ? 'Email' : 'WhatsApp'} ·{' '}
              {convo.status.replace(/_/g, ' ').toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Mobile pane toggle */}
          <div className="mr-2 inline-flex rounded-md border bg-background p-0.5 md:hidden">
            <button
              type="button"
              onClick={() => setPane('chat')}
              className={
                pane === 'chat'
                  ? 'rounded bg-foreground px-2 py-1 text-xs text-background'
                  : 'rounded px-2 py-1 text-xs text-muted-foreground'
              }
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setPane('preview')}
              className={
                pane === 'preview'
                  ? 'rounded bg-foreground px-2 py-1 text-xs text-background'
                  : 'rounded px-2 py-1 text-xs text-muted-foreground'
              }
            >
              Preview
            </button>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href={`/t/${tenantSlug}/agent`}>All conversations</Link>
          </Button>
          {!isFinalized && !isAbandoned && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAbandonOpen(true)}
            >
              Abandon
            </Button>
          )}
        </div>
      </header>

      {/* Body — two pane on md+, single pane on mobile */}
      <div className="flex min-h-0 flex-1">
        <ChatPane
          className={
            pane === 'chat'
              ? 'flex w-full flex-col border-r md:w-2/5'
              : 'hidden w-full flex-col border-r md:flex md:w-2/5'
          }
          channel={channel}
          messages={convo.messages.map(serverMsgToView)}
          streamingText={stream.streamingText}
          toolCalls={stream.toolCalls}
          streaming={stream.status === 'streaming'}
          error={stream.lastError}
          input={input}
          onInput={setInput}
          onSend={handleSend}
          disabled={isFinalized || isAbandoned}
          finalizedRedirectTo={stream.finalizedRedirectTo}
        />
        <PreviewPane
          channel={channel}
          conversationId={conversationId}
          finalizedRedirectTo={stream.finalizedRedirectTo ?? (isFinalized && convo.producedCampaignId
            ? `/t/${tenantSlug}/campaigns/${convo.producedCampaignId}/${channel === 'EMAIL' ? 'design' : 'whatsapp'}`
            : null)}
          className={
            pane === 'preview'
              ? 'flex w-full min-h-0 flex-col'
              : 'hidden w-full min-h-0 flex-col md:flex md:w-3/5'
          }
        />
      </div>

      {/* Abandon confirm */}
      <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Abandon this conversation?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The drafted state is lost. You can start a fresh conversation
            anytime from <code>Campaigns → New</code>.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbandonOpen(false)}>
              Keep going
            </Button>
            <Button
              variant="destructive"
              disabled={abandon.isPending}
              onClick={() => abandon.mutate({ id: conversationId })}
            >
              {abandon.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Abandon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Chat pane
// ----------------------------------------------------------------------------

interface MessageView {
  role: 'USER' | 'ASSISTANT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'SYSTEM';
  content: string | null;
  toolName: string | null;
  toolOutput: unknown;
  errorMessage: string | null;
}

function serverMsgToView(m: {
  role: string;
  content: string | null;
  toolName: string | null;
  toolOutput: unknown;
  errorMessage: string | null;
}): MessageView {
  return {
    role: m.role as MessageView['role'],
    content: m.content,
    toolName: m.toolName,
    toolOutput: m.toolOutput,
    errorMessage: m.errorMessage,
  };
}

function ChatPane({
  className,
  channel,
  messages,
  streamingText,
  toolCalls,
  streaming,
  error,
  input,
  onInput,
  onSend,
  disabled,
  finalizedRedirectTo,
}: {
  className: string;
  channel: Channel;
  messages: MessageView[];
  streamingText: string;
  toolCalls: { id: string; name: string; output?: unknown; error?: string }[];
  streaming: boolean;
  error: string | null;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  finalizedRedirectTo: string | null;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, streamingText, toolCalls.length]);

  return (
    <section className={className}>
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4 pb-2"
      >
        {messages.length === 0 && !streaming && (
          <EmptyState channel={channel} />
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {streaming && (
          <>
            {toolCalls.map((tc) => (
              <ToolCallPill key={tc.id} call={tc} />
            ))}
            {streamingText && (
              <MessageBubble
                msg={{
                  role: 'ASSISTANT',
                  content: streamingText,
                  toolName: null,
                  toolOutput: null,
                  errorMessage: null,
                }}
              />
            )}
            <StreamingIndicator />
          </>
        )}
        {finalizedRedirectTo && <FinalizedBanner channel={channel} />}
        {error && (
          <div className="rounded-lg border border-rose-300 bg-rose-50/60 px-3 py-2 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        className="border-t bg-background p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => onInput(e.target.value)}
            placeholder={
              disabled
                ? 'Conversation is closed.'
                : streaming
                  ? 'Wait for the agent to finish…'
                  : 'Reply to the agent…'
            }
            disabled={disabled || streaming}
            autoFocus
          />
          <Button type="submit" size="icon" disabled={disabled || streaming || !input.trim()}>
            <Send className="size-4" />
          </Button>
        </div>
      </form>
    </section>
  );
}

function EmptyState({ channel }: { channel: Channel }): JSX.Element {
  // Phase 7 M6 — 30-second tutorial. Three short tips + one channel
  // -specific worked example.
  const tips =
    channel === 'EMAIL'
      ? [
          'Name your audience (a segment).',
          'Describe the campaign — goal, tone, what to include.',
          "I'll propose blocks; tweak in chat or open the editor when ready.",
        ]
      : [
          "Name your audience (a segment) and what number you're sending from.",
          'Either pick an APPROVED template or describe a new one.',
          "Fill {{1}}, {{2}} — literal values or contact merge tags.",
        ];
  const example =
    channel === 'EMAIL'
      ? '"Black Friday sale, 30% off everything, send to All Subscribers, friendly tone, hero image + 3-feature section."'
      : '"Order shipped notification with tracking link, send to Active Customers from the main number, use contact.firstName for the greeting."';
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-violet-300/40 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-orange-50 p-5 text-sm dark:border-violet-900/40 dark:from-violet-950/30 dark:via-fuchsia-950/20 dark:to-orange-950/20">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-900 dark:text-violet-200">
          <Sparkles className="size-3.5" />
          How this works (30 seconds)
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-foreground/80">
          {tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      </div>
      <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm">
        <p className="text-xs font-medium text-muted-foreground">
          Try something like
        </p>
        <p className="mt-1 italic text-foreground/80">{example}</p>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: MessageView }): JSX.Element | null {
  if (msg.role === 'SYSTEM') return null;
  if (msg.role === 'TOOL_CALL' || msg.role === 'TOOL_RESULT') {
    return (
      <ToolCallPill
        call={{
          id: `${msg.toolName}-${Math.random()}`,
          name: msg.toolName ?? 'tool',
          output: msg.toolOutput,
          error: msg.errorMessage ?? undefined,
        }}
      />
    );
  }
  const isUser = msg.role === 'USER';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-sm ' +
          (isUser
            ? 'bg-foreground text-background'
            : 'bg-card border')
        }
      >
        {msg.content ?? ''}
      </div>
    </div>
  );
}

function ToolCallPill({
  call,
}: {
  call: { id: string; name: string; output?: unknown; error?: string };
}): JSX.Element {
  const summary = summariseToolOutput(call.name, call.output);
  const isError = !!call.error;
  return (
    <div
      className={
        'flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] ' +
        (isError
          ? 'border-rose-300 bg-rose-50/60 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
          : 'border-violet-300 bg-violet-50/60 text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200')
      }
    >
      <CheckCircle2 className={'size-3 ' + (isError ? 'opacity-0' : '')} />
      {isError ? <X className="size-3" /> : null}
      <code className="font-mono">{call.name}</code>
      {summary && <span className="text-foreground/80">— {summary}</span>}
      {call.error && <span className="opacity-80">— {call.error}</span>}
    </div>
  );
}

function summariseToolOutput(name: string, output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const o = output as Record<string, unknown>;
  if (name === 'set_goal' && typeof o.goal === 'string') return o.goal;
  if (name === 'set_audience' && typeof o.segmentName === 'string')
    return `audience: ${o.segmentName}`;
  if (name === 'set_subject_line' && typeof o.subject === 'string')
    return `subject: ${o.subject}`;
  if (name === 'propose_design_plan' && typeof o.blockCount === 'number')
    return `${o.blockCount} blocks`;
  if (name === 'add_block' && typeof o.blockCount === 'number')
    return `now ${o.blockCount} blocks`;
  if (name === 'remove_block' && typeof o.blockCount === 'number')
    return `now ${o.blockCount} blocks`;
  if (name === 'pick_existing_template' && typeof o.templateName === 'string')
    return o.templateName;
  if (name === 'draft_new_template' && typeof o.templateId === 'string')
    return 'new template drafted, awaiting Meta approval';
  if (name === 'set_phone_number' && typeof o.phoneNumber === 'string')
    return o.phoneNumber;
  if (name === 'set_template_variables' && typeof o.filled === 'number')
    return `${o.filled} variable${o.filled === 1 ? '' : 's'} filled`;
  if (name === 'finalize_draft') return 'draft ready';
  return '';
}

function StreamingIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
      <span className="inline-flex gap-0.5">
        <span className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground" />
        <span className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '120ms' }} />
        <span className="inline-block size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: '240ms' }} />
      </span>
      Thinking…
    </div>
  );
}

function FinalizedBanner({ channel }: { channel: Channel }): JSX.Element {
  return (
    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
        <CheckCircle2 className="size-4" />
        Draft ready!
      </div>
      <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-200/70">
        Opening the {channel === 'EMAIL' ? 'editor' : 'WhatsApp wizard'}…
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Preview pane
// ----------------------------------------------------------------------------

function PreviewPane({
  channel,
  conversationId,
  finalizedRedirectTo,
  className,
}: {
  channel: Channel;
  conversationId: string;
  finalizedRedirectTo: string | null;
  className: string;
}): JSX.Element {
  return (
    <section className={className}>
      <div className="flex items-center justify-between border-b bg-card px-4 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Live preview
        </p>
        {finalizedRedirectTo && (
          <Button asChild size="sm" variant="default">
            <Link href={finalizedRedirectTo}>
              Open in editor <ArrowRight className="ml-1.5 size-3.5" />
            </Link>
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {channel === 'EMAIL' ? (
          <EmailPreviewPane conversationId={conversationId} />
        ) : (
          <WhatsAppPreviewPane conversationId={conversationId} />
        )}
      </div>
    </section>
  );
}

// Re-export icon so the existing build doesn't break if Smartphone moves elsewhere.
void Smartphone;
// useMemo placeholder for future suggested-replies wiring
void useMemo;
