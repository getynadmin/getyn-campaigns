'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  EmailBuilder,
  type DesignJson,
  type EmailBuilderSavePayload,
} from '@/components/email-builder/email-builder';
import { api } from '@/lib/trpc';

/**
 * Hosts EmailBuilder for one Email node inside an automation. Save
 * writes designJson + renderedHtml back onto the node via
 * `automation.saveNodeDesign`; the back button returns to the builder.
 *
 * Automations don't have per-node test-send today (M9 polish). We
 * disable the Send Test button rather than wire something half-baked.
 */
export function AutomationNodeDesignClient({
  automationId,
  automationName,
  slug,
  nodeId,
  initialDesign,
  initialSubject,
  nodeLabel,
}: {
  automationId: string;
  automationName: string;
  slug: string;
  nodeId: string;
  initialDesign: DesignJson;
  initialSubject: string;
  nodeLabel: string;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const save = api.automation.saveNodeDesign.useMutation({
    onSuccess: () => {
      toast.success('Design saved.');
      void utils.automation.get.invalidate({ id: automationId });
    },
    onError: (err) => toast.error(err.message ?? 'Save failed.'),
  });

  return (
    <EmailBuilder
      initialDesign={initialDesign}
      tenantSlug={slug}
      backHref={`/t/${slug}/automation/drip/${automationId}/edit`}
      title={`${automationName} · ${nodeLabel}`}
      onSave={async ({ designJson, renderedHtml }: EmailBuilderSavePayload) => {
        // Plaintext fallback derived cheaply — the send pipeline
        // re-derives when the operator hasn't set one, so a rough
        // strip is fine.
        const textBody = renderedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        await save.mutateAsync({
          id: automationId,
          nodeId,
          subject: initialSubject,
          designJson,
          renderedHtml,
          textBody,
        });
        // Return to builder — matches operator expectation after Save.
        router.push(`/t/${slug}/automation/drip/${automationId}/edit`);
      }}
      onSendTest={async () => {
        toast.error('Per-node test sends are not yet wired for automations.');
      }}
      mergeTags={[
        { name: 'First name', value: '{{contact.firstName}}', sample: 'Alex' },
        { name: 'Last name', value: '{{contact.lastName}}', sample: 'Rivera' },
        { name: 'Email', value: '{{contact.email}}', sample: 'alex@example.com' },
        { name: 'Workspace name', value: '{{tenant.name}}', sample: 'Acme Inc' },
      ]}
    />
  );
}
