'use client';

import Link from 'next/link';
import { ArrowRight, ExternalLink, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { renderTemplateHtml } from '@/lib/render-template-html';

type Props = {
  tenantSlug: string;
  template: {
    id: string;
    name: string;
    description: string | null;
    tenantId: string | null;
    designJson: unknown;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreate: boolean;
  onUseTemplate: (id: string) => void;
  useTemplatePending: boolean;
};

/**
 * Preview an email template in an iframe (srcdoc for isolation).
 * System templates show "Use template"; tenant templates show
 * "Open in editor" and "Use in campaign".
 */
export function TemplatePreviewDialog({
  tenantSlug,
  template,
  open,
  onOpenChange,
  canCreate,
  onUseTemplate,
  useTemplatePending,
}: Props): JSX.Element | null {
  if (!template) return null;
  const isSystem = template.tenantId === null;
  const html = renderTemplateHtml(template.designJson) || '<p style="padding:40px;text-align:center;color:#888;font-family:sans-serif;">This template has no design yet. Open the editor to start.</p>';

  // Dummy sample data for preview — the real send merges real contact
  // values; here we just want the preview to not look like a Mustache
  // template.
  const substituted = html
    .replace(/\{\{first_name\}\}/g, 'Alex')
    .replace(/\{\{firstName\}\}/g, 'Alex')
    .replace(/\{\{last_name\}\}/g, 'Rivera')
    .replace(/\{\{email\}\}/g, 'alex@example.com')
    .replace(/\{\{tenantName\}\}/g, 'Getyn')
    .replace(/\{\{companyName\}\}/g, 'Getyn')
    .replace(/\{\{unsubscribeUrl\}\}/g, '#')
    .replace(/\{\{webViewUrl\}\}/g, '#')
    .replace(/\{\{orderId\}\}/g, '1024')
    .replace(/\{\{orderDate\}\}/g, 'Nov 7, 2026');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          {template.description ? (
            <DialogDescription>{template.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="h-[520px] overflow-hidden rounded-md border bg-white">
          <iframe
            title={template.name}
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=600"></head><body style="margin:0;background:#f4f4f7;">${substituted}</body></html>`}
            className="h-full w-full"
            sandbox=""
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!isSystem ? (
            <Button variant="outline" asChild>
              <Link href={`/t/${tenantSlug}/templates/${template.id}/design`}>
                <Pencil className="mr-1 size-4" />
                Open in editor
                <ExternalLink className="ml-1 size-3.5 opacity-60" />
              </Link>
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              onClick={() => onUseTemplate(template.id)}
              disabled={useTemplatePending}
            >
              {isSystem ? 'Use template' : 'Duplicate'}
              <ArrowRight className="ml-1 size-4" />
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
