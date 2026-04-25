import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

type Tenant = { id: string; name: string; slug: string };

/**
 * The outer chrome for every tenant page: sidebar on the left, topbar
 * on top, scrollable content on the right. Passes all data it needs
 * from the tenant layout's RSC resolution — no client data fetching
 * on the shell itself.
 */
export function AppShell({
  currentSlug,
  tenants,
  user,
  children,
}: {
  currentSlug: string;
  tenants: Tenant[];
  user: { name: string | null; email: string; avatarUrl: string | null };
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar tenantSlug={currentSlug} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar currentSlug={currentSlug} tenants={tenants} user={user} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
