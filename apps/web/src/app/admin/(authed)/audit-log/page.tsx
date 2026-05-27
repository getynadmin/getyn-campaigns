import { AdminAuditLogClient } from '@/components/admin/audit-log-client';

export const metadata = { title: 'Audit log · Staff' };

export default function AdminAuditLogPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every staff action across every tenant. Append-only; nothing in
          the codebase mutates these rows.
        </p>
      </header>
      <AdminAuditLogClient />
    </div>
  );
}
