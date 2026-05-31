import { Info } from 'lucide-react';

import { SmsServersPlaceholderClient } from '@/components/admin/integrations/sms-servers-placeholder-client';

export const metadata = { title: 'SMS Servers · Integrations' };

export default function AdminSmsServersPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">SMS Servers</h1>
        <p className="text-sm text-muted-foreground">
          SMS marketing is planned for a future release. Configuration UI is
          shown here for reference.
        </p>
      </header>
      <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          SMS provider hookups land after the WhatsApp + Email integrations
          stabilize. The fields below are read-only placeholders.
        </p>
      </div>
      <SmsServersPlaceholderClient />
    </div>
  );
}
