'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUp,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  X,
} from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Strip the markdown tokens the model occasionally emits even though
 * the system prompt forbids them — belt-and-suspenders so no raw
 * `**bold**` or leading `- ` ever reaches the user.
 */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_(?!\s)(.+?)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '');
}

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{ slug: string; title: string }>;
};

const INTRO: Message = {
  id: 'intro',
  role: 'assistant',
  content:
    "Hi! I'm the Getyn assistant. Ask me anything about campaigns, templates, channels, billing — I'll point you at the right docs too.",
};

/**
 * Floating bottom-right help chat. Uses the gradient language of the
 * AiButton so it reads as an AI surface. Logged-in only; the tRPC
 * procedure (`help.ask`) fails closed for anonymous visitors.
 *
 * State is intentionally in-memory per mount — no persistence — so
 * the panel is a quick back-channel, not a long conversation history.
 */
export function HelpAssistant(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([INTRO]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ask = api.help.ask.useMutation({
    onSuccess: (res) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.answer,
          citations: res.citations,
        },
      ]);
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: err.message || 'Something went wrong. Try again?',
        },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, ask.isPending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = (): void => {
    const q = input.trim();
    if (!q || ask.isPending) return;
    const history = messages
      .filter((m) => m.id !== 'intro')
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: q },
    ]);
    setInput('');
    ask.mutate({ question: q, history });
  };

  return (
    <>
      {open ? (
        <div
          className={cn(
            'fixed bottom-20 right-5 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border bg-background shadow-2xl',
            'max-h-[calc(100vh-7rem)]',
          )}
          role="dialog"
          aria-label="Help assistant"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="ai-btn-wrap grid size-7 place-items-center rounded-full p-[1.5px]">
                <span className="grid size-full place-items-center rounded-full bg-background">
                  <Sparkles className="ai-btn-sparkle size-3.5 text-violet-500" />
                </span>
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold">Getyn assistant</div>
                <div className="text-[11px] text-muted-foreground">
                  Answers + docs, instantly
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'flex',
                  m.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                    m.role === 'user'
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-foreground',
                  )}
                >
                  <div>{stripMarkdown(m.content)}</div>
                  {m.citations && m.citations.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2 text-xs">
                      {m.citations.map((c) => (
                        <Link
                          key={c.slug}
                          href={`/docs/${c.slug}`}
                          className="text-violet-600 hover:underline dark:text-violet-300"
                        >
                          {c.title} →
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {ask.isPending ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t p-3">
            <div className="flex items-end gap-2 rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Ask anything about Getyn…"
                className="flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={send}
                disabled={ask.isPending || input.trim().length < 2}
                className="m-1 grid size-8 place-items-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-40"
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Powered by Getyn AI. Doesn&apos;t count against your AI credits.
            </p>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close help assistant' : 'Open help assistant'}
        className={cn(
          'ai-btn-wrap fixed bottom-5 right-5 z-50 grid size-14 place-items-center rounded-full p-[2px] shadow-xl transition-transform hover:scale-105',
        )}
      >
        <span className="grid size-full place-items-center rounded-full bg-background">
          {open ? (
            <X className="size-5 text-foreground" />
          ) : (
            <MessageCircleQuestion className="size-6 text-violet-500" />
          )}
        </span>
      </button>
    </>
  );
}
