import { ClipboardList } from 'lucide-react';

export const metadata = { title: 'Webhook log · Staff' };

/**
 * Phase 5 M7 — placeholder.
 *
 * Lands real in M8 polish, alongside the G-Suite webhook table.
 * Today we have GSuiteWebhookEvent + WhatsAppWebhookEvent rows; a
 * unified view across both is the right surface for ops debugging
 * but isn't critical for M7 sign-off.
 */
export default function WebhookLogPage(): JSX.Element {
  return (
    <div className="grid h-96 place-items-center rounded-lg border border-dashed bg-card text-center">
      <div>
        <ClipboardList className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">Webhook log</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Lands in M8 polish — unified view of GSuiteWebhookEvent +
          WhatsAppWebhookEvent rows, filterable by tenant + event type.
        </p>
      </div>
    </div>
  );
}
