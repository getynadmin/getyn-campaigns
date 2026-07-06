'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Check, Edit3, Loader2, LogOut, X } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Approval Inbox — human-in-the-loop gate for the Email Agent's
 * reply drafts. Two-column: list on the left, detail + actions on
 * the right. Keyboard shortcuts (J/K navigate, A approve, E edit,
 * R reject, X exit) so the daily driver can rip through a queue
 * without touching the mouse.
 */
export function ApprovalInboxClient(): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [rejectPromptOpen, setRejectPromptOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  const { data: list, isLoading, refetch } = api.emailAgentInbox.list.useQuery({});
  const detail = api.emailAgentInbox.get.useQuery(
    { id: selectedId ?? '' },
    { enabled: selectedId !== null },
  );

  const utils = api.useUtils();
  const invalidate = useCallback(() => {
    void utils.emailAgentInbox.list.invalidate();
    void utils.emailAgentInbox.get.invalidate();
    void utils.emailAgentInbox.pendingCount.invalidate();
  }, [utils]);

  const approve = api.emailAgentInbox.approve.useMutation({
    onSuccess: () => {
      toast.success('Sent.');
      invalidate();
      moveToNext();
    },
    onError: (err) => toast.error(err.message),
  });
  const editAndSend = api.emailAgentInbox.editAndSend.useMutation({
    onSuccess: () => {
      toast.success('Sent with edits.');
      invalidate();
      setEditorOpen(false);
      moveToNext();
    },
    onError: (err) => toast.error(err.message),
  });
  const reject = api.emailAgentInbox.reject.useMutation({
    onSuccess: () => {
      toast.success('Rejected.');
      invalidate();
      setRejectPromptOpen(false);
      setRejectReason('');
      moveToNext();
    },
    onError: (err) => toast.error(err.message),
  });
  const exit = api.emailAgentInbox.exit.useMutation({
    onSuccess: () => {
      toast.success('Enrollment ended.');
      invalidate();
      moveToNext();
    },
    onError: (err) => toast.error(err.message),
  });

  const items = list?.items ?? [];

  const moveToNext = useCallback(() => {
    if (!selectedId) return;
    const idx = items.findIndex((i) => i.id === selectedId);
    const next = items[idx + 1] ?? items[idx - 1] ?? null;
    setSelectedId(next?.id ?? null);
  }, [items, selectedId]);

  const moveDir = useCallback(
    (dir: 1 | -1) => {
      if (items.length === 0) return;
      const idx = selectedId
        ? items.findIndex((i) => i.id === selectedId)
        : -1;
      const nextIdx = Math.max(0, Math.min(items.length - 1, idx + dir));
      setSelectedId(items[nextIdx]?.id ?? null);
    },
    [items, selectedId],
  );

  const openEditor = useCallback(() => {
    if (!detail.data) return;
    setEditSubject(detail.data.message.subject);
    setEditBody(detail.data.message.bodyText);
    setEditorOpen(true);
  }, [detail.data]);

  // Auto-select first row.
  useEffect(() => {
    if (selectedId === null && items.length > 0) {
      setSelectedId(items[0]!.id);
    }
  }, [items, selectedId]);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'j':
          moveDir(1);
          e.preventDefault();
          break;
        case 'k':
          moveDir(-1);
          e.preventDefault();
          break;
        case 'a':
          if (selectedId) approve.mutate({ id: selectedId });
          e.preventDefault();
          break;
        case 'e':
          openEditor();
          e.preventDefault();
          break;
        case 'r':
          setRejectPromptOpen(true);
          e.preventDefault();
          break;
        case 'x':
          if (selectedId && confirm('Exit this enrollment entirely?')) {
            exit.mutate({ id: selectedId });
          }
          e.preventDefault();
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveDir, selectedId, approve, openEditor, exit]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5" />
          <h1 className="font-display text-lg font-semibold">Approval inbox</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {items.length} pending
          </span>
        </div>
        <div className="hidden text-[11px] text-muted-foreground md:block">
          <span className="mr-3"><kbd className="rounded border px-1">J</kbd>/<kbd className="rounded border px-1">K</kbd> navigate</span>
          <span className="mr-3"><kbd className="rounded border px-1">A</kbd> approve</span>
          <span className="mr-3"><kbd className="rounded border px-1">E</kbd> edit</span>
          <span className="mr-3"><kbd className="rounded border px-1">R</kbd> reject</span>
          <span><kbd className="rounded border px-1">X</kbd> exit</span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,380px)_minmax(0,1fr)] overflow-hidden">
        {/* List */}
        <aside className="overflow-y-auto border-r">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Bot className="mx-auto size-6 opacity-30" />
              <p className="mt-2">No drafts awaiting approval.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((row) => (
                <li key={row.id}>
                  <button
                    onClick={() => setSelectedId(row.id)}
                    className={cn(
                      'flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
                      selectedId === row.id && 'bg-muted/60',
                    )}
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {row.enrollment.contact.firstName
                          ? `${row.enrollment.contact.firstName}${row.enrollment.contact.lastName ? ` ${row.enrollment.contact.lastName}` : ''}`
                          : row.enrollment.contact.email}
                      </span>
                      {row.inboundClassification && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                          {row.inboundClassification}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {row.enrollment.emailAgent.name} · {row.subject}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatRelative(row.createdAt)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Detail + actions */}
        <div className="min-w-0 overflow-y-auto">
          {selectedId === null ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Select a draft to review.
            </div>
          ) : detail.isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : detail.data ? (
            <DetailPane
              detail={detail.data}
              onApprove={() => approve.mutate({ id: selectedId })}
              onEdit={openEditor}
              onReject={() => setRejectPromptOpen(true)}
              onExit={() => {
                if (confirm('Exit this enrollment entirely?')) {
                  exit.mutate({ id: selectedId });
                }
              }}
              busy={approve.isPending || reject.isPending || exit.isPending}
            />
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Not found — it may have been resolved by another operator.
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => refetch()}>
                Refresh
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit &amp; send</DialogTitle>
            <DialogDescription>
              Make changes, then send to the contact. Signature is appended
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              placeholder="Subject"
            />
            <textarea
              className="min-h-64 w-full rounded-md border bg-background p-3 font-mono text-sm"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                selectedId &&
                editAndSend.mutate({
                  id: selectedId,
                  subject: editSubject,
                  bodyText: editBody,
                })
              }
              disabled={editAndSend.isPending}
            >
              {editAndSend.isPending && (
                <Loader2 className="mr-1 size-4 animate-spin" />
              )}
              Send edited
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject prompt */}
      <Dialog open={rejectPromptOpen} onOpenChange={setRejectPromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this draft?</DialogTitle>
            <DialogDescription>
              Optional reason — the agent will use these as guidance next time
              it drafts a reply for this contact.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Too pushy, wrong tone, etc."
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectPromptOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                selectedId &&
                reject.mutate({
                  id: selectedId,
                  reason: rejectReason.trim() || undefined,
                })
              }
              disabled={reject.isPending}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------
// Detail pane
// -----------------------------------------------------------------

type DetailProps = {
  detail: {
    message: {
      id: string;
      subject: string;
      bodyText: string;
      inboundClassification: string | null;
      createdAt: string | Date;
      aiGenerationCostCents: number;
      enrollment: {
        emailAgent: { name: string; tone: string; goal: string; fromEmail: string };
        contact: { email: string | null; firstName: string | null; lastName: string | null };
      };
    };
    thread: {
      id: string;
      direction: string;
      subject: string;
      bodyText: string;
      createdAt: string | Date;
    }[];
  };
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  onExit: () => void;
  busy: boolean;
};

function DetailPane({ detail, onApprove, onEdit, onReject, onExit, busy }: DetailProps): JSX.Element {
  const { message, thread } = detail;
  const contact = message.enrollment.contact;
  const contactLabel = contact.firstName
    ? `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`
    : contact.email;
  // Find the most recent inbound to show above the draft.
  const inboundIdx = thread.map((m) => m.direction).lastIndexOf('INBOUND');
  const inbound = inboundIdx === -1 ? null : thread[inboundIdx];
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {message.enrollment.emailAgent.name} → {contactLabel}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Tone {message.enrollment.emailAgent.tone.toLowerCase()} · draft cost{' '}
          {formatCents(message.aiGenerationCostCents)}
        </p>
      </header>

      {inbound && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
            Contact wrote:
          </p>
          <p className="mt-1 text-sm font-medium">{inbound.subject}</p>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 font-sans text-xs">
            {inbound.bodyText || '(empty)'}
          </pre>
        </div>
      )}

      <div className="rounded-lg border p-4">
        <p className="text-xs font-medium">Agent draft</p>
        <p className="mt-2 text-sm font-medium">{message.subject}</p>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-muted/20 p-2 font-sans text-sm">
          {message.bodyText}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button onClick={onApprove} disabled={busy}>
          <Check className="mr-1 size-4" /> Approve &amp; send
        </Button>
        <Button variant="outline" onClick={onEdit} disabled={busy}>
          <Edit3 className="mr-1 size-4" /> Edit
        </Button>
        <Button variant="outline" onClick={onReject} disabled={busy}>
          <X className="mr-1 size-4" /> Reject
        </Button>
        <Button variant="ghost" onClick={onExit} disabled={busy} className="text-rose-700">
          <LogOut className="mr-1 size-4" /> Exit enrollment
        </Button>
      </div>

      {thread.length > 1 && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-xs font-medium">
            Thread history ({thread.length} messages)
          </summary>
          <ul className="mt-3 space-y-3">
            {thread.map((m) => (
              <li key={m.id} className="text-xs">
                <p className="font-medium">
                  {m.direction === 'INBOUND' ? '↓ Inbound' : '↑ Outbound'} · {m.subject}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {m.bodyText.slice(0, 400)}
                  {m.bodyText.length > 400 && '…'}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatRelative(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

function formatCents(cents: number): string {
  if (cents === 0) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}
