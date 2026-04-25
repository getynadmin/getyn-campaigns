'use client';

import { toast } from 'sonner';

import {
  EmailBuilder,
  type DesignJson,
  type EmailBuilderSavePayload,
} from './email-builder';
import { api } from '@/lib/trpc';

/**
 * Client-side host for the email builder when editing a single
 * EmailTemplate. Wires save + sendTest + merge tags to tRPC.
 */
export function TemplateDesignClient({
  template,
  tenantSlug,
  canEdit,
}: {
  template: {
    id: string;
    name: string;
    description: string | null;
    designJson: DesignJson;
    isSystemTemplate: boolean;
  };
  tenantSlug: string;
  canEdit: boolean;
}): JSX.Element {
  const utils = api.useUtils();
  const update = api.emailTemplate.update.useMutation({
    onSuccess: () => {
      toast.success('Template saved.');
      void utils.emailTemplate.get.invalidate({ id: template.id });
    },
    onError: (err) => toast.error(err.message ?? 'Save failed.'),
  });
  const sendTest = api.emailTemplate.sendTest.useMutation({
    onSuccess: (res) =>
      toast.success(`Test sent to ${res.sentTo} recipient${res.sentTo === 1 ? '' : 's'}.`),
    onError: (err) => toast.error(err.message ?? 'Test send failed.'),
  });

  // System templates can't be edited; we still let the user open the
  // editor in read-only mode (Unlayer doesn't have a true read-only
  // mode, but the Save button below is hidden by passing a no-op).
  if (template.isSystemTemplate || !canEdit) {
    return (
      <div className="flex h-dvh flex-col bg-background">
        <div className="border-b bg-amber-50 px-6 py-3 text-sm dark:bg-amber-950/40">
          {template.isSystemTemplate ? (
            <>
              <span className="font-medium">System template — read-only.</span>{' '}
              Click "Use template" from the library to make a tenant-owned
              copy you can edit.
            </>
          ) : (
            <>You don't have permission to edit this template.</>
          )}
        </div>
        <EmailBuilder
          initialDesign={template.designJson}
          tenantSlug={tenantSlug}
          backHref={`/t/${tenantSlug}/templates`}
          title={template.name}
          onSave={async () => {
            toast.error('Read-only template.');
          }}
          onSendTest={async () => {
            toast.error('Read-only template.');
          }}
        />
      </div>
    );
  }

  return (
    <EmailBuilder
      initialDesign={template.designJson}
      tenantSlug={tenantSlug}
      backHref={`/t/${tenantSlug}/templates`}
      title={template.name}
      onSave={async ({ designJson }: EmailBuilderSavePayload) => {
        await update.mutateAsync({
          id: template.id,
          patch: {
            designJson,
            // We don't store renderedHtml for templates — they're rendered
            // fresh when used in a campaign. This mirrors the Phase 3 schema:
            // renderedHtml lives on EmailCampaign, not EmailTemplate.
          },
        });
      }}
      onSendTest={async (recipients) => {
        await sendTest.mutateAsync({
          id: template.id,
          recipients,
        });
      }}
      mergeTags={[
        { name: 'First name', value: '{{firstName}}', sample: 'Alex' },
        { name: 'Last name', value: '{{lastName}}', sample: 'Rivera' },
        { name: 'Email', value: '{{email}}', sample: 'alex@example.com' },
        {
          name: 'Unsubscribe URL',
          value: '{{unsubscribeUrl}}',
          sample: 'https://example.com/unsubscribe',
        },
        {
          name: 'Web view URL',
          value: '{{webViewUrl}}',
          sample: 'https://example.com/view',
        },
        {
          name: 'Workspace name',
          value: '{{tenantName}}',
          sample: 'Acme Inc',
        },
      ]}
    />
  );
}
