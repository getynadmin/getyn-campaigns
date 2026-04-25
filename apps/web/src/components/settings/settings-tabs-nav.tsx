'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const tabs = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'team', label: 'Team' },
  { key: 'custom-fields', label: 'Custom fields' },
  { key: 'billing', label: 'Billing' },
  { key: 'channels', label: 'Channels' },
] as const;

/**
 * Settings tab strip. Each tab is a real route (not a `<Tabs>` primitive)
 * so deep links like `/t/acme/settings/team` work and server components
 * can keep doing their own data fetching.
 */
export function SettingsTabsNav({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const pathname = usePathname() ?? '';
  const base = `/t/${tenantSlug}/settings`;

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const href = tab.key === 'workspace' ? base : `${base}/${tab.key}`;
        const active =
          tab.key === 'workspace'
            ? pathname === base
            : pathname.startsWith(href);
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
