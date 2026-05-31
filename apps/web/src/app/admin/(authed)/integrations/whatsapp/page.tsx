import { WhatsAppIntegrationClient } from '@/components/admin/integrations/whatsapp-integration-client';

export const metadata = { title: 'WhatsApp · Integrations' };

export default function AdminWhatsAppIntegrationPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Meta credentials drive Embedded Signup, webhook signature
          verification, and the WhatsApp Business API for tenant
          campaigns. DB values override env vars when this integration
          is enabled.
        </p>
      </header>
      <WhatsAppIntegrationClient />
    </div>
  );
}
