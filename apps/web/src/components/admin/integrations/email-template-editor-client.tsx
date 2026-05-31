'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Code2, Copy, Loader2, Save, Send } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

/**
 * Phase 5.6 M3b — system email template editor.
 *
 * Left pane: editable fields (name, description, subject, HTML, text,
 * enabled). Right pane: live render preview with sample variable
 * values. Variables surface as copyable chips so authors can paste
 * them into their copy without typo-ing the braces.
 *
 * Send test dispatches the rendered email through sendSystemEmail
 * (SMTP first, Resend fallback, console last).
 */

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function render(
  template: string,
  vars: Record<string, string>,
  html: boolean,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) => {
    if (!(key in vars)) return m;
    const v = String(vars[key]);
    return html ? v.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c) : v;
  });
}

export function EmailTemplateEditorClient({
  templateId,
}: {
  templateId: string;
}): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.emailTemplate.get.useQuery({
    id: templateId,
  });
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    if (!data || hydrated) return;
    setName(data.name);
    setDescription(data.description ?? '');
    setSubject(data.subject);
    setBodyHtml(data.bodyHtml);
    setBodyText(data.bodyText);
    setEnabled(data.enabled);
    const variables = (data.variables as string[]) ?? [];
    const sample: Record<string, string> = {};
    for (const v of variables) sample[v] = `[${v}]`;
    setPreviewVars(sample);
    setHydrated(true);
  }, [data, hydrated]);

  const variables = useMemo(
    () => (data ? ((data.variables as string[]) ?? []) : []),
    [data],
  );

  const save = adminApi.integrations.emailTemplate.update.useMutation({
    onSuccess: () => {
      toast.success('Template saved.');
      void utils.integrations.emailTemplate.get.invalidate({ id: templateId });
      void utils.integrations.emailTemplate.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const sendTest = adminApi.integrations.emailTemplate.sendTest.useMutation({
    onSuccess: (res) => {
      toast.success(`Sent via ${res.via}.`);
      setTestOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !data) return <Skeleton className="h-screen" />;

  const renderedSubject = render(subject, previewVars, false);
  const renderedHtml = render(bodyHtml, previewVars, true);

  const generateTextFromHtml = () => {
    // crude: strip tags, collapse whitespace
    const stripped = bodyHtml
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    setBodyText(stripped);
    toast.success('Plaintext regenerated from HTML.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/integrations/email-templates">
            <ArrowLeft className="mr-2 size-4" />
            Back
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTestOpen(true)}>
            <Send className="mr-2 size-4" />
            Send test
          </Button>
          <Button
            onClick={() =>
              save.mutate({
                id: templateId,
                name,
                description,
                subject,
                bodyHtml,
                bodyText,
                enabled,
              })
            }
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Slug (read-only)</Label>
              <Input value={data.slug} readOnly className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category (read-only)</Label>
              <Input value={data.category} readOnly />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <textarea
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Available variables</Label>
            <div className="flex flex-wrap gap-1">
              {variables.length === 0 ? (
                <span className="text-xs text-muted-foreground">None</span>
              ) : (
                variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(`{{${v}}}`);
                      toast.success(`{{${v}}} copied.`);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-foreground hover:bg-muted"
                  >
                    <Copy className="size-2.5" />
                    {`{{${v}}}`}
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Body — HTML</Label>
            <textarea
              rows={14}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Body — Plain text</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateTextFromHtml}
                className="h-6 text-xs"
              >
                <Code2 className="mr-1 size-3" />
                Generate from HTML
              </Button>
            </div>
            <textarea
              rows={8}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-foreground"
            />
            <span>Enabled</span>
          </label>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Preview</h3>
          {variables.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Sample variables</Label>
              {variables.map((v) => (
                <div key={v} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 font-mono text-muted-foreground">
                    {v}
                  </span>
                  <Input
                    value={previewVars[v] ?? ''}
                    onChange={(e) =>
                      setPreviewVars((p) => ({ ...p, [v]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <Label className="text-xs">Rendered subject</Label>
            <p className="mt-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {renderedSubject || (
                <span className="italic text-muted-foreground">empty</span>
              )}
            </p>
          </div>
          <div>
            <Label className="text-xs">Rendered HTML</Label>
            <div
              className="prose prose-sm mt-1 max-w-none rounded-md border bg-white p-4 text-foreground dark:prose-invert"
              // Preview-only. Render expects already-escaped variable
              // values (we ran HTML-escape during substitution).
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        </section>
      </div>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send test email</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Recipient</Label>
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Renders with the sample variables on the right.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={sendTest.isPending || !testTo.trim()}
              onClick={() =>
                sendTest.mutate({
                  slug: data.slug,
                  to: testTo.trim(),
                  variables: previewVars,
                })
              }
            >
              {sendTest.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
