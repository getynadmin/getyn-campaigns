import { AdminStaffClient } from '@/components/admin/staff-client';

export const metadata = { title: 'Staff · Staff' };

export default function AdminStaffPage(): JSX.Element {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold">Staff</h1>
        <p className="text-sm text-muted-foreground">
          People with access to <code>/admin</code>. SUPPORT_ADMINs can
          invite + remove; SUPPORT can only see this list.
        </p>
      </header>
      <AdminStaffClient />
    </div>
  );
}
