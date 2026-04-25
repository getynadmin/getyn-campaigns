'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Eye,
  Loader2,
  Save,
  Send,
} from 'lucide-react';

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

// Unlayer's embed touches `window` on import, so it has to load lazily on
// the client. SSR-mode rendering would crash; dynamic with ssr: false
// keeps the page server-rendered for the surrounding chrome and only the
// editor iframe lands client-side.
const EmailEditor = dynamic(() => import('react-email-editor'), { ssr: false });

/**
 * The shape of designJson is opaque to us — Unlayer's internal payload.
 * We type it loosely to keep the editor's saveDesign callback happy.
 */
export type DesignJson = Record<string, unknown>;

export interface EmailBuilderSavePayload {
  designJson: DesignJson;
  renderedHtml: string;
}

export interface EmailBuilderProps {
  /** Initial design — null for a brand new template/campaign. */
  initialDesign?: DesignJson | null;
  /** Tenant slug for image-upload routing (we POST to /api/email-assets/upload?tenant=...). */
  tenantSlug: string;
  /** Where the back arrow goes — typically the parent list page. */
  backHref: string;
  /** Page title shown in the header (e.g. "Spring Newsletter — Design"). */
  title: string;
  /** Persists the design + rendered HTML. Called by the Save button. */
  onSave: (payload: EmailBuilderSavePayload) => Promise<void>;
  /**
   * Sends a test email to up to 5 recipients. The parent runs the actual
   * send via tRPC and resolves the toast — we just open the dialog and
   * collect the addresses here.
   */
  onSendTest: (recipients: string[]) => Promise<void>;
  /**
   * Merge tags surfaced in Unlayer's variable picker. Parents fetch from
   * the tenant's CustomField registry + system defaults and pass the
   * combined list down.
   */
  mergeTags?: { name: string; value: string; sample?: string }[];
}

/**
 * Reusable Unlayer editor wrapper for both EmailTemplate (M3+M4) and
 * EmailCampaign (M5) design pages.
 *
 * The editor lives in a full-height iframe; we sandwich it between a
 * sticky toolbar (back / save / preview / send test) and nothing else,
 * so it gets the entire viewport below the topbar.
 */
export function EmailBuilder({
  initialDesign,
  tenantSlug,
  backHref,
  title,
  onSave,
  onSendTest,
  mergeTags,
}: EmailBuilderProps): JSX.Element {
  const editorRef = useRef<UnlayerEditorLike | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>(
    'desktop',
  );
  const [testOpen, setTestOpen] = useState(false);

  const onReady = useCallback(
    (unlayer: UnlayerEditorLike) => {
      // Hand the parent a stable ref to the editor.
      editorRef.current = unlayer;

      // Replay the initial design once Unlayer is ready. (Unlayer doesn't
      // accept design via props — it's an imperative API.)
      if (initialDesign) {
        try {
          unlayer.loadDesign(initialDesign);
        } catch (e) {
          console.error('[email-builder] loadDesign failed', e);
        }
      }

      // Custom image uploader — replaces Unlayer's default that would
      // otherwise put images on Unlayer's CDN. Ours go in our Supabase
      // Storage email-assets bucket, scoped per tenant.
      unlayer.registerCallback?.('image', async (file, done) => {
        const formData = new FormData();
        formData.append('file', file.attachments?.[0] ?? (file as unknown as File));
        try {
          const res = await fetch(
            `/api/email-assets/upload?tenant=${encodeURIComponent(tenantSlug)}`,
            { method: 'POST', body: formData },
          );
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `${res.status}`);
          }
          const json = (await res.json()) as { url: string };
          done({ progress: 100, url: json.url });
        } catch (err) {
          console.error('[email-builder] image upload failed', err);
          toast.error(
            err instanceof Error ? err.message : 'Image upload failed',
          );
          done({ progress: 0, url: '' });
        }
      });

      setIsReady(true);
    },
    [initialDesign, tenantSlug],
  );

  const captureDesignAndHtml = useCallback(async (): Promise<EmailBuilderSavePayload> => {
    const editor = editorRef.current;
    if (!editor) throw new Error('Editor not ready yet.');
    const design = await new Promise<DesignJson>((resolve) => {
      editor.saveDesign((d) => resolve(d as DesignJson));
    });
    const html = await new Promise<string>((resolve) => {
      editor.exportHtml((data) => resolve(data?.html ?? ''));
    });
    return { designJson: design, renderedHtml: html };
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const payload = await captureDesignAndHtml();
      await onSave(payload);
    } finally {
      setIsSaving(false);
    }
  }, [captureDesignAndHtml, onSave]);

  const handlePreview = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.exportHtml((data) => setPreviewHtml(data?.html ?? ''));
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 size-4" />
            Back
          </Link>
        </Button>
        <div className="flex-1 truncate font-display text-base font-semibold">
          {title}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePreview}
          disabled={!isReady}
        >
          <Eye className="mr-2 size-4" />
          Preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTestOpen(true)}
          disabled={!isReady}
        >
          <Send className="mr-2 size-4" />
          Send test
        </Button>
        <Button onClick={handleSave} disabled={!isReady || isSaving}>
          {isSaving ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}
          Save
        </Button>
      </header>

      <div className="flex-1 overflow-hidden">
        {/*
          Cast options through `unknown` — Unlayer's type schema for
          mergeTags is index-keyed (`Record<string, MergeTag>`) while
          we prefer a typed array at the call site. Safer to cast once
          here than fight the upstream types in every consumer.
        */}
        <EmailEditor
          minHeight="100%"
          onReady={(u) => onReady(u as unknown as UnlayerEditorLike)}
          options={UNLAYER_OPTIONS({
            mergeTags,
          })}
        />
      </div>

      {/* Preview modal — desktop / mobile toggle */}
      <Dialog
        open={previewHtml !== null}
        onOpenChange={(o) => (o ? null : setPreviewHtml(null))}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Preview</DialogTitle>
              <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewMode('desktop')}
                  className={
                    previewMode === 'desktop'
                      ? 'rounded bg-foreground px-2 py-1 font-medium text-background'
                      : 'rounded px-2 py-1 text-muted-foreground hover:text-foreground'
                  }
                >
                  Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('mobile')}
                  className={
                    previewMode === 'mobile'
                      ? 'rounded bg-foreground px-2 py-1 font-medium text-background'
                      : 'rounded px-2 py-1 text-muted-foreground hover:text-foreground'
                  }
                >
                  Mobile
                </button>
              </div>
            </div>
            <DialogDescription>
              Rendered HTML at current state. Merge tags show as-is.
            </DialogDescription>
          </DialogHeader>
          {previewHtml !== null ? (
            <div className="mx-auto h-[600px] overflow-hidden rounded-lg border bg-white">
              <iframe
                title="Email preview"
                sandbox="allow-same-origin"
                srcDoc={previewHtml}
                className="h-full w-full"
                style={{
                  width: previewMode === 'mobile' ? 360 : '100%',
                  margin: previewMode === 'mobile' ? '0 auto' : undefined,
                }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Send test dialog */}
      <SendTestDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        onSend={async (recipients) => {
          // Save before sending so the test email matches what's
          // currently in the editor.
          await handleSave();
          await onSendTest(recipients);
        }}
      />
    </div>
  );
}

function SendTestDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSend: (recipients: string[]) => Promise<void>;
}): JSX.Element {
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);

  const recipients = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const valid =
    recipients.length > 0 &&
    recipients.length <= 5 &&
    recipients.every((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a test email</DialogTitle>
          <DialogDescription>
            Up to 5 recipients. Test sends bypass the queue and don't count
            toward your daily send limit. Merge tags use sample values when
            no contact context is available.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="you@yourcompany.com, teammate@yourcompany.com"
          />
          <p className="text-xs text-muted-foreground">
            Comma- or space-separated. {recipients.length} valid email
            {recipients.length === 1 ? '' : 's'}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSend(recipients);
                onOpenChange(false);
                setRaw('');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Sending…' : 'Send test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Loose Unlayer types — the upstream `@unlayer/types` package isn't
// stable across minor versions, and we only use a tiny subset here.
type UnlayerEditorLike = {
  loadDesign: (design: DesignJson) => void;
  saveDesign: (cb: (design: unknown) => void) => void;
  exportHtml: (cb: (data: { html?: string } | null) => void) => void;
  registerCallback?: (
    name: 'image',
    cb: (file: { attachments?: File[] } & Record<string, unknown>, done: (r: { progress: number; url: string }) => void) => void,
  ) => void;
};

/**
 * Build the Unlayer options object. Returns `any`-shape because Unlayer's
 * upstream types are awkward to satisfy precisely (mergeTags wants
 * an index-keyed record, displayMode unioning across email/document/etc.,
 * etc.). The shape we send is well-known from the Unlayer docs; the
 * runtime behavior matters more than satisfying the upstream generics.
 */
function UNLAYER_OPTIONS(args: {
  mergeTags?: { name: string; value: string; sample?: string }[];
}): never {
  return {
    displayMode: 'email',
    features: {
      userUploads: true,
      stockImages: false,
    },
    mergeTags: args.mergeTags?.map((t) => ({
      name: t.name,
      value: t.value,
      sample: t.sample,
    })),
    appearance: { theme: 'light' },
    projectId: process.env.NEXT_PUBLIC_UNLAYER_PROJECT_ID
      ? Number(process.env.NEXT_PUBLIC_UNLAYER_PROJECT_ID)
      : undefined,
  } as never;
}
