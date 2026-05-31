import { SmtpIntegrationClient } from '@/components/admin/integrations/smtp-integration-client';

export const metadata = { title: 'Email SMTP · Integrations' };

export default function AdminSmtpIntegrationPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Email SMTP</h1>
        <p className="text-sm text-muted-foreground">
          SMTP server for system notification emails — signups, password
          resets, plan upgrades, impersonation notices. Tenant marketing
          campaigns go through Resend (see Sending Servers).
        </p>
      </header>
      <SmtpIntegrationClient />
    </div>
  );
}
