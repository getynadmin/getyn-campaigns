import { EmailTemplatesListClient } from '@/components/admin/integrations/email-templates-list-client';

export const metadata = { title: 'Email Templates · Integrations' };

export default function AdminEmailTemplatesPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Email Templates</h1>
        <p className="text-sm text-muted-foreground">
          System notification templates (welcome, password reset, plan upgrades,
          impersonation notices, …). Edit copy, subject lines, and variables;
          system templates can&apos;t be deleted.
        </p>
      </header>
      <EmailTemplatesListClient />
    </div>
  );
}
