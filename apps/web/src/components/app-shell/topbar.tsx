import { UserMenu } from './user-menu';
import { WorkspaceSwitcher } from './workspace-switcher';

type Tenant = { id: string; name: string; slug: string };

/**
 * Topbar slotted into every tenant route. Left side is the workspace
 * switcher; right side is the user menu. Any page-level title should
 * come from page content below, not the topbar.
 */
export function Topbar({
  currentSlug,
  tenants,
  user,
}: {
  currentSlug: string;
  tenants: Tenant[];
  user: { name: string | null; email: string; avatarUrl: string | null };
}): JSX.Element {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-2">
        <WorkspaceSwitcher currentSlug={currentSlug} tenants={tenants} />
      </div>
      <div className="flex items-center gap-2">
        <UserMenu
          name={user.name}
          email={user.email}
          avatarUrl={user.avatarUrl}
        />
      </div>
    </header>
  );
}
