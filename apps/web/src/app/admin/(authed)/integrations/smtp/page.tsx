export const metadata = { title: 'Email SMTP · Integrations' };

export default function AdminSmtpIntegrationPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Email SMTP</h1>
        <p className="text-sm text-muted-foreground">
          Coming in Phase 5.6 M3a.
        </p>
      </header>
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        SMTP server form lands in M3.
      </div>
    </div>
  );
}
