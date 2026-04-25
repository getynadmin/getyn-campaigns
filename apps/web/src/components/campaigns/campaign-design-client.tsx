'use client';

import { toast } from 'sonner';

import {
  EmailBuilder,
  type DesignJson,
  type EmailBuilderSavePayload,
} from '@/components/email-builder/email-builder';
import { api } from '@/lib/trpc';

/**
 * Hosts the EmailBuilder for a Campaign. The save flow writes both
 * `designJson` and `renderedHtml` via `campaign.saveDesign` — keeping
 * them in lockstep so we never serve a stale renderedHtml.
 *
 * Test sends go through the campaign's actual settings (subject, from
 * name, etc.) rather than the template's stub. For now we re-use the
 * template sendTest flow once the design is saved — full campaign
 * test send lands in M9 polish since it needs the renderedHtml +
 * sample merge data substitution to be wired through.
 */
export function CampaignDesignClient({
  campaign,
  tenantSlug,
  canEdit,
}: {
  campaign: {
    id: string;
    name: string;
    designJson: DesignJson;
    isDraft: boolean;
  };
  tenantSlug: string;
  canEdit: boolean;
}): JSX.Element {
  const utils = api.useUtils();
  const save = api.campaign.saveDesign.useMutation({
    onSuccess: () => {
      toast.success('Design saved.');
      void utils.campaign.get.invalidate({ id: campaign.id });
    },
    onError: (err) => toast.error(err.message ?? 'Save failed.'),
  });

  if (!canEdit) {
    return (
      <div className="flex h-dvh flex-col bg-background">
        <div className="border-b bg-amber-50 px-6 py-3 text-sm dark:bg-amber-950/40">
          {campaign.isDraft ? (
            <>You don't have permission to edit this campaign's design.</>
          ) : (
            <>
              <span className="font-medium">Read-only.</span> Designs are
              locked once a campaign moves out of DRAFT.
            </>
          )}
        </div>
        <EmailBuilder
          initialDesign={campaign.designJson}
          tenantSlug={tenantSlug}
          backHref={`/t/${tenantSlug}/campaigns/${campaign.id}`}
          title={campaign.name}
          onSave={async () => {
            toast.error('Design is locked.');
          }}
          onSendTest={async () => {
            toast.error('Design is locked.');
          }}
        />
      </div>
    );
  }

  return (
    <EmailBuilder
      initialDesign={campaign.designJson}
      tenantSlug={tenantSlug}
      backHref={`/t/${tenantSlug}/campaigns/${campaign.id}`}
      title={campaign.name}
      onSave={async ({ designJson, renderedHtml }: EmailBuilderSavePayload) => {
        await save.mutateAsync({
          id: campaign.id,
          designJson,
          renderedHtml,
        });
      }}
      onSendTest={async () => {
        toast.message('Test send from campaigns lands in the polish pass.', {
          description:
            'For now, use a template to test design + merge tags. Campaign-specific test send wires up in M9.',
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
