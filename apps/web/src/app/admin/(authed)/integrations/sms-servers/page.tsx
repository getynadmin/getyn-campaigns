export const metadata = { title: 'SMS Servers · Integrations' };

export default function AdminSmsServersPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">SMS Servers</h1>
        <p className="text-sm text-muted-foreground">
          Coming in Phase 5.6 M4b (placeholder UI only).
        </p>
      </header>
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Twilio + MSG91 placeholders land in M4.
      </div>
    </div>
  );
}
