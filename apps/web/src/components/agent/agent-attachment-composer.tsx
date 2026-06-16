'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/trpc';

const ALLOWED_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  conversationId: string;
  disabled?: boolean;
}

interface PillState {
  attachmentId: string;
  fileName: string;
  attachmentType: 'IMAGE' | 'PDF' | 'SPREADSHEET' | 'DOCUMENT';
  sizeBytes: number;
  parsing: boolean;
}

/**
 * Phase 7.2 — minimal attachment composer.
 *
 * Sits above the agent chat input. Paperclip button opens a file
 * picker; drag-drop is handled by the parent. Each upload posts to
 * /api/agent/attachments/upload and renders a pill row that polls
 * `agentAttachments.list` until `parsedAt` lands.
 *
 * The pills are the entire UI — no side-preview pane (deferred to the
 * full 7.1 M2 build). Users reference attachments by mentioning them
 * in chat; the agent resolves IDs via the system-prompt context.
 */
export function AgentAttachmentComposer({
  conversationId,
  disabled,
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [localPills, setLocalPills] = useState<PillState[]>([]);

  const list = api.agentAttachments.list.useQuery(
    { conversationId },
    {
      // Poll while anything is still parsing so the spinner clears.
      refetchInterval: (q) => {
        const data = q.state.data;
        if (!data) return false;
        const anyParsing = data.some((a) => a.parsedAt === null);
        return anyParsing ? 2_000 : false;
      },
    },
  );

  // Merge optimistic local pills + server list. Server takes precedence
  // once it knows about an attachmentId.
  const pills: PillState[] = (() => {
    const serverIds = new Set((list.data ?? []).map((a) => a.id));
    const optimistic = localPills.filter(
      (p) => !serverIds.has(p.attachmentId),
    );
    const server: PillState[] = (list.data ?? []).map((a) => ({
      attachmentId: a.id,
      fileName: a.fileName,
      attachmentType: a.attachmentType as PillState['attachmentType'],
      sizeBytes: a.sizeBytes,
      parsing: a.parsedAt === null,
    }));
    return [...server, ...optimistic];
  })();

  // Drop optimistic rows once the server picks them up.
  useEffect(() => {
    if (!list.data) return;
    const serverIds = new Set(list.data.map((a) => a.id));
    setLocalPills((prev) =>
      prev.filter((p) => !serverIds.has(p.attachmentId)),
    );
  }, [list.data]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      for (const file of arr) {
        if (!ALLOWED_MIME.includes(file.type)) {
          toast.error(`${file.name}: unsupported file type.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name}: exceeds 10MB limit.`);
          continue;
        }
        setUploading((n) => n + 1);
        try {
          const form = new FormData();
          form.append('file', file);
          form.append('conversationId', conversationId);
          const res = await fetch('/api/agent/attachments/upload', {
            method: 'POST',
            body: form,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            toast.error(
              `${file.name}: ${body?.error ?? `Upload failed (${res.status})`}`,
            );
            continue;
          }
          const data = (await res.json()) as {
            attachmentId: string;
            attachmentType: PillState['attachmentType'];
            sizeBytes: number;
          };
          setLocalPills((prev) => [
            ...prev,
            {
              attachmentId: data.attachmentId,
              fileName: file.name,
              attachmentType: data.attachmentType,
              sizeBytes: data.sizeBytes,
              parsing: true,
            },
          ]);
          // Trigger a refetch so the server-side pill appears + the
          // polling kicks in to clear the parsing spinner.
          void list.refetch();
        } catch (err) {
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : 'Network error'}`,
          );
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [conversationId, list],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) void upload(files);
      // Reset so picking the same file twice re-fires the change event.
      e.target.value = '';
    },
    [upload],
  );

  // Drag-drop is wired by the parent via `useAttachmentDropTarget`
  // (exported below). We expose `upload(files)` via a ref-callable
  // pattern, but for simplicity the parent just calls `dispatchUpload`
  // through a context-free prop — done via the AgentChatClient wiring
  // referencing this component's upload function indirectly through
  // the page-level drop handler.

  return (
    <div className="space-y-2">
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <AttachmentPill key={p.attachmentId} pill={p} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_MIME.join(',')}
          className="hidden"
          onChange={onPick}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          title="Attach file (image, PDF, CSV, XLSX, DOC)"
        >
          {uploading > 0 ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function AttachmentPill({ pill }: { pill: PillState }): JSX.Element {
  const Icon =
    pill.attachmentType === 'IMAGE'
      ? ImageIcon
      : pill.attachmentType === 'SPREADSHEET'
        ? FileSpreadsheet
        : FileText;
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
      title={pill.fileName}
    >
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="max-w-[140px] truncate">{pill.fileName}</span>
      {pill.parsing && (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * Helper: same upload routine, exposed for a wrapping drag-drop
 * surface (e.g. the chat panel root). Kept as a hook so callers don't
 * duplicate the toast/fetch logic.
 */
export function useAttachmentUpload(conversationId: string) {
  const utils = api.useUtils();
  return useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const file of arr) {
        if (!ALLOWED_MIME.includes(file.type)) {
          toast.error(`${file.name}: unsupported file type.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name}: exceeds 10MB limit.`);
          continue;
        }
        try {
          const form = new FormData();
          form.append('file', file);
          form.append('conversationId', conversationId);
          const res = await fetch('/api/agent/attachments/upload', {
            method: 'POST',
            body: form,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            toast.error(
              `${file.name}: ${body?.error ?? `Upload failed (${res.status})`}`,
            );
            continue;
          }
          await utils.agentAttachments.list.invalidate({ conversationId });
        } catch (err) {
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : 'Network error'}`,
          );
        }
      }
    },
    [conversationId, utils],
  );
}
