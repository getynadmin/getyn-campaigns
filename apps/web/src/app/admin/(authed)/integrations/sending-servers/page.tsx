import { SendingServersClient } from '@/components/admin/integrations/sending-servers-client';

export const metadata = { title: 'Sending Servers · Integrations' };

export default function AdminSendingServersPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Sending Servers</h1>
        <p className="text-sm text-muted-foreground">
          Providers for outbound traffic. Resend powers tenant campaigns;
          Railway hosts the worker fleet.
        </p>
      </header>
      <SendingServersClient />
    </div>
  );
}
