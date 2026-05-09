'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  Send,
  UserCircle,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RouterOutputs } from '@/lib/trpc';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

// tRPC output helpers — declared once so the row/bubble props get
// concrete types without per-component derivation acrobatics.
type ConversationListItem =
  RouterOutputs['whatsAppInbox']['listConversations']['items'][number];
type MessageItem =
  RouterOutputs['whatsAppInbox']['listMessages']['items'][number];

/**
 * Phase 4 M10 — WhatsApp inbox.
 *
 * Three-pane responsive layout:
 *   - Conversation list (left) — paginated, filtered, searchable.
 *   - Thread (center) — message bubbles, day separators, composer.
 *   - Contact details (right) — name, status, recent activity, close.
 *
 * Realtime: a 5s tRPC poll on listMessages with direction=newer keeps
 * the thread fresh. Supabase Realtime would be cleaner but ties us to
 * a specific JWT scope; polling is simpler and Phase 4-correct.
 *
 * Service window: composer adapts based on serviceWindowExpiresAt.
 * Open → free-form text. Closed → "Send a template message" panel
 * (template picker; M6 templates filter to APPROVED).
 *
 * Mobile (<768px): conversation list and thread stack; pick a
 * conversation to drill in. We bail with a "Use desktop" message
 * for the contact-details pane on phone widths.
 */

type Filter = 'all' | 'unread' | 'mine' | 'open' | 'closed';

interface InboxClientProps {
  tenantSlug: string;
  currentUser: { id: string; name: string };
  canCloseReopen: boolean;
}

export function InboxClient({
  tenantSlug,
  currentUser,
  canCloseReopen,
}: InboxClientProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div className="grid h-[calc(100dvh-8rem)] grid-cols-[320px_1fr_320px] gap-3 lg:grid-cols-[320px_1fr_320px] md:grid-cols-[280px_1fr] sm:grid-cols-1">
      <ConversationList
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        activeId={activeId}
        onSelect={setActiveId}
        currentUserId={currentUser.id}
      />
      <ThreadPane
        conversationId={activeId}
        currentUser={currentUser}
        canCloseReopen={canCloseReopen}
        onBack={() => setActiveId(null)}
        tenantSlug={tenantSlug}
      />
      <DetailsPane conversationId={activeId} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Conversation list
// ----------------------------------------------------------------------------

function ConversationList({
  filter,
  onFilterChange,
  search,
  onSearchChange,
  activeId,
  onSelect,
  currentUserId,
}: {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  currentUserId: string;
}): JSX.Element {
  const list = api.whatsAppInbox.listConversations.useQuery(
    { filter, ...(search.length >= 2 ? { search } : {}) },
    { refetchInterval: 10_000 },
  );
  const items = list.data?.items ?? [];

  return (
    <aside className="flex h-full flex-col rounded-lg border bg-card">
      <header className="space-y-3 border-b p-3">
        <Input
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <Tabs value={filter} onValueChange={(v) => onFilterChange(v as Filter)}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="closed">Closed</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      <div className="flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
            <div>
              <MessageSquare className="mx-auto size-8 opacity-40" />
              <p className="mt-3">No conversations match this filter.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                currentUserId={currentUserId}
                onClick={() => onSelect(c.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ConversationRow({
  conversation,
  active,
  currentUserId,
  onClick,
}: {
  conversation: ConversationListItem;
  active: boolean;
  currentUserId: string;
  onClick: () => void;
}): JSX.Element {
  const name = conversation.contact
    ? [conversation.contact.firstName, conversation.contact.lastName]
        .filter(Boolean)
        .join(' ') || conversation.contactPhone
    : conversation.contactPhone;
  const closing = serviceWindowState(conversation.serviceWindowExpiresAt);
  const mine = conversation.assignedToUserId === currentUserId;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
          active && 'bg-muted/60',
        )}
      >
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
          {(name[0] ?? '?').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {timeAgo(conversation.lastMessageAt)}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.lastMessagePreview || 'No messages yet'}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px]">
            {conversation.unreadCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground">
                {conversation.unreadCount}
              </span>
            )}
            {closing.label && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5',
                  closing.tone,
                )}
              >
                <Clock className="size-2.5" /> {closing.label}
              </span>
            )}
            {mine && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                Mine
              </span>
            )}
            {conversation.status === 'CLOSED' && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                Closed
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

// ----------------------------------------------------------------------------
// Thread pane
// ----------------------------------------------------------------------------

function ThreadPane({
  conversationId,
  currentUser,
  canCloseReopen,
  onBack,
  tenantSlug,
}: {
  conversationId: string | null;
  currentUser: { id: string; name: string };
  canCloseReopen: boolean;
  onBack: () => void;
  tenantSlug: string;
}): JSX.Element {
  const utils = api.useUtils();
  const conv = api.whatsAppInbox.getConversation.useQuery(
    { id: conversationId ?? '' },
    { enabled: Boolean(conversationId) },
  );
  const messages = api.whatsAppInbox.listMessages.useQuery(
    {
      conversationId: conversationId ?? '',
      direction: 'older',
      limit: 50,
    },
    {
      enabled: Boolean(conversationId),
      refetchInterval: 5_000, // realtime poll
    },
  );

  const markRead = api.whatsAppInbox.markAsRead.useMutation({
    onSuccess: () =>
      void utils.whatsAppInbox.listConversations.invalidate(),
  });

  // Auto-mark as read on open.
  useEffect(() => {
    if (
      conversationId &&
      conv.data &&
      conv.data.unreadCount > 0
    ) {
      markRead.mutate({ id: conversationId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conv.data?.unreadCount]);

  if (!conversationId) {
    return (
      <section className="grid h-full place-items-center rounded-lg border border-dashed bg-card text-center">
        <div className="px-8 text-sm text-muted-foreground">
          <MessageSquare className="mx-auto size-10 opacity-30" />
          <p className="mt-3">Pick a conversation to start.</p>
        </div>
      </section>
    );
  }
  if (!conv.data || messages.isLoading) {
    return (
      <section className="rounded-lg border bg-card">
        <Skeleton className="h-full" />
      </section>
    );
  }

  const items = (messages.data?.items ?? []).slice().reverse();
  const grouped = groupByDay(items);
  const window = serviceWindowState(conv.data.serviceWindowExpiresAt);

  return (
    <section className="flex h-full flex-col rounded-lg border bg-card">
      <header className="flex items-center gap-3 border-b p-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="grid size-9 place-items-center rounded-full bg-muted">
          <UserCircle className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {conv.data.contact
              ? [conv.data.contact.firstName, conv.data.contact.lastName]
                  .filter(Boolean)
                  .join(' ') || conv.data.contactPhone
              : conv.data.contactPhone}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{conv.data.contactPhone}</span>
            {window.label && (
              <span className={cn('ml-2', window.text)}>· {window.label}</span>
            )}
          </p>
        </div>
        <ThreadActions
          conversationId={conversationId}
          status={conv.data.status as 'OPEN' | 'CLOSED'}
          canCloseReopen={canCloseReopen}
        />
      </header>

      <div className="flex-1 overflow-y-auto bg-[#e5ddd5]/40 p-4 dark:bg-zinc-900/40">
        {grouped.map((g) => (
          <div key={g.day} className="mb-4">
            <div className="my-2 text-center">
              <span className="rounded-full bg-background/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {g.day}
              </span>
            </div>
            <ul className="space-y-1">
              {g.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </ul>
          </div>
        ))}
        {items.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No messages yet.
          </p>
        )}
      </div>

      <Composer
        conversationId={conversationId}
        windowOpen={window.open}
        sentByUserName={currentUser.name}
        tenantSlug={tenantSlug}
      />
    </section>
  );
}

function ThreadActions({
  conversationId,
  status,
  canCloseReopen,
}: {
  conversationId: string;
  status: 'OPEN' | 'CLOSED';
  canCloseReopen: boolean;
}): JSX.Element {
  const utils = api.useUtils();
  const close = api.whatsAppInbox.close.useMutation({
    onSuccess: () => {
      toast.success('Conversation closed.');
      void utils.whatsAppInbox.getConversation.invalidate({
        id: conversationId,
      });
      void utils.whatsAppInbox.listConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const reopen = api.whatsAppInbox.reopen.useMutation({
    onSuccess: () => {
      toast.success('Conversation reopened.');
      void utils.whatsAppInbox.getConversation.invalidate({
        id: conversationId,
      });
      void utils.whatsAppInbox.listConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!canCloseReopen) return <></>;
  if (status === 'CLOSED') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => reopen.mutate({ id: conversationId })}
      >
        Reopen
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => close.mutate({ id: conversationId })}
    >
      <X className="mr-1 size-3.5" /> Close
    </Button>
  );
}

// ----------------------------------------------------------------------------
// Message bubble
// ----------------------------------------------------------------------------

function MessageBubble({
  message,
}: {
  message: MessageItem;
}): JSX.Element {
  const outbound = message.direction === 'OUTBOUND';
  return (
    <li className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm',
          outbound
            ? 'bg-primary/10 text-foreground'
            : 'bg-card text-foreground',
        )}
      >
        {message.type === 'TEMPLATE' && (
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Template
          </p>
        )}
        {message.body && (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
        {!message.body && (
          <p className="italic text-muted-foreground">
            {message.type.toLowerCase().replace('_', ' ')}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <span>{formatHM(message.sentAt ?? message.createdAt)}</span>
          {outbound && <StatusIcon status={message.status} />}
        </div>
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: string }): JSX.Element {
  if (status === 'READ') return <CheckCheck className="size-3 text-blue-500" />;
  if (status === 'DELIVERED') return <CheckCheck className="size-3" />;
  if (status === 'SENT') return <Check className="size-3" />;
  if (status === 'FAILED') return <AlertCircle className="size-3 text-rose-500" />;
  return <Clock className="size-3 animate-pulse" />;
}

// ----------------------------------------------------------------------------
// Composer
// ----------------------------------------------------------------------------

function Composer({
  conversationId,
  windowOpen,
  sentByUserName,
  tenantSlug,
}: {
  conversationId: string;
  windowOpen: boolean;
  sentByUserName: string;
  tenantSlug: string;
}): JSX.Element {
  const [text, setText] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const utils = api.useUtils();

  const sendText = api.whatsAppInbox.sendTextReply.useMutation({
    onSuccess: () => {
      setText('');
      void utils.whatsAppInbox.listMessages.invalidate({ conversationId });
      void utils.whatsAppInbox.listConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const onSend = (): void => {
    if (text.trim().length === 0) return;
    sendText.mutate({ conversationId, body: text.trim() });
  };

  if (!windowOpen) {
    return (
      <>
        <footer className="border-t bg-muted/30 p-3 text-center text-xs text-muted-foreground">
          <Clock className="mr-1 inline size-3" />
          Service window is closed — only template messages can be sent.
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => setShowTemplates(true)}
          >
            <MessageSquare className="mr-1 size-3.5" /> Send template
          </Button>
        </footer>
        {showTemplates && (
          <TemplatePickerDialog
            open={showTemplates}
            onOpenChange={setShowTemplates}
            conversationId={conversationId}
            tenantSlug={tenantSlug}
          />
        )}
      </>
    );
  }

  return (
    <footer className="border-t p-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={2}
          placeholder={`Reply as ${sentByUserName} — Enter to send, Shift+Enter for newline`}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
        />
        <Button
          size="icon"
          disabled={sendText.isPending || text.trim().length === 0}
          onClick={onSend}
        >
          {sendText.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </footer>
  );
}

function TemplatePickerDialog({
  open,
  onOpenChange,
  conversationId,
  tenantSlug,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
  tenantSlug: string;
}): JSX.Element {
  const templates = api.whatsAppTemplate.list.useQuery(
    { status: 'APPROVED' },
    { enabled: open },
  );
  const utils = api.useUtils();
  const send = api.whatsAppInbox.sendTemplateReply.useMutation({
    onSuccess: () => {
      toast.success('Template sent.');
      onOpenChange(false);
      void utils.whatsAppInbox.listMessages.invalidate({ conversationId });
      void utils.whatsAppInbox.listConversations.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const items = templates.data?.items ?? [];

  if (!open) return <></>;
  return (
    <div className="absolute inset-0 grid place-items-center bg-background/90 p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Pick a template</h4>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        {templates.isLoading ? (
          <Skeleton className="h-32" />
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No APPROVED templates.{' '}
            <a
              className="underline"
              href={`/t/${tenantSlug}/settings/channels/whatsapp/templates`}
            >
              Author one
            </a>
            .
          </p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {items.map((t) => (
              <li
                key={t.id}
                className="cursor-pointer rounded-md border p-3 text-xs hover:border-primary/40"
                onClick={() =>
                  send.mutate({
                    conversationId,
                    templateId: t.id,
                    templateLanguage: t.language,
                    bodyParams: [],
                  })
                }
              >
                <p className="font-mono">{t.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {t.language} · {t.category}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Details pane
// ----------------------------------------------------------------------------

function DetailsPane({
  conversationId,
}: {
  conversationId: string | null;
}): JSX.Element {
  const conv = api.whatsAppInbox.getConversation.useQuery(
    { id: conversationId ?? '' },
    { enabled: Boolean(conversationId) },
  );
  if (!conversationId) {
    return (
      <aside className="hidden rounded-lg border bg-card lg:block">
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          —
        </div>
      </aside>
    );
  }
  if (!conv.data) {
    return (
      <aside className="hidden rounded-lg border bg-card lg:block">
        <Skeleton className="h-full" />
      </aside>
    );
  }
  const c = conv.data;

  return (
    <aside className="hidden rounded-lg border bg-card lg:flex lg:flex-col">
      <header className="border-b p-4 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
          <UserCircle className="size-7 text-muted-foreground" />
        </div>
        <p className="mt-2 font-medium">
          {c.contact
            ? [c.contact.firstName, c.contact.lastName]
                .filter(Boolean)
                .join(' ') || c.contactPhone
            : c.contactPhone}
        </p>
        <p className="text-xs text-muted-foreground">
          <Phone className="mr-1 inline size-3" />
          {c.contactPhone}
        </p>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {!c.contactId && (
          <div className="rounded-md border border-dashed bg-muted/30 p-3 text-center">
            <p>Unknown sender — not yet linked to a contact.</p>
            <p className="mt-1 text-muted-foreground">
              Convert in the contacts page after their next message.
            </p>
          </div>
        )}
        {c.contact && (
          <Field label="Email" value={c.contact.email ?? '—'} />
        )}
        <Field
          label="Service window"
          value={
            c.serviceWindowExpiresAt
              ? new Date(c.serviceWindowExpiresAt) > new Date()
                ? `Open · expires ${new Date(c.serviceWindowExpiresAt).toLocaleString()}`
                : `Closed since ${new Date(c.serviceWindowExpiresAt).toLocaleString()}`
              : 'Never opened'
          }
        />
        <Field
          label="Assigned"
          value={c.assignedTo ? c.assignedTo.name ?? c.assignedTo.email ?? '—' : 'Nobody'}
        />
        <Field label="Status" value={c.status} />
        <Field
          label="Last inbound"
          value={c.lastInboundAt ? new Date(c.lastInboundAt).toLocaleString() : '—'}
        />
        <Field
          label="Last outbound"
          value={c.lastOutboundAt ? new Date(c.lastOutboundAt).toLocaleString() : '—'}
        />
      </div>
    </aside>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function timeAgo(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

function formatHM(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function serviceWindowState(at: Date | string | null): {
  open: boolean;
  label: string;
  tone: string;
  text: string;
} {
  if (!at) return { open: false, label: '', tone: '', text: '' };
  const date = typeof at === 'string' ? new Date(at) : at;
  const ms = date.getTime() - Date.now();
  if (ms <= 0) {
    return {
      open: false,
      label: 'Window closed',
      tone: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
      text: 'text-rose-700 dark:text-rose-400',
    };
  }
  const h = ms / 3_600_000;
  if (h < 2) {
    return {
      open: true,
      label: `Closing soon (${Math.ceil(h * 60)}m)`,
      tone: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
      text: 'text-amber-700 dark:text-amber-400',
    };
  }
  return {
    open: true,
    label: `Window open (${Math.floor(h)}h)`,
    tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    text: 'text-emerald-700 dark:text-emerald-400',
  };
}

interface MessageGroup {
  day: string;
  messages: MessageItem[];
}

function groupByDay(messages: MessageItem[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const m of messages) {
    const d = new Date(m.sentAt ?? m.createdAt);
    const key = d.toDateString();
    const label =
      key === today
        ? 'Today'
        : key === yesterday
        ? 'Yesterday'
        : d.toLocaleDateString();
    if (!current || current.day !== label) {
      current = { day: label, messages: [] };
      groups.push(current);
    }
    current.messages.push(m);
  }
  return groups;
}

void useMemo;
