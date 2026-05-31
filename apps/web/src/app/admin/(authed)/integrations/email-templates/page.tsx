export const metadata = { title: 'Email Templates · Integrations' };

export default function AdminEmailTemplatesPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Email Templates</h1>
        <p className="text-sm text-muted-foreground">
          Coming in Phase 5.6 M3b.
        </p>
      </header>
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Template list + editor lands in M3.
      </div>
    </div>
  );
}
