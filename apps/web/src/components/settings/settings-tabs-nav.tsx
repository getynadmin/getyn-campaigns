'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const tabs = [
  { key: 'profile', label: 'My profile' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'brand', label: 'Brand' },
  { key: 'team', label: 'Team' },
  { key: 'custom-fields', label: 'Custom fields' },
  { key: 'sending-domains', label: 'Sending domains' },
  { key: 'subscription', label: 'Subscription' },
  { key: 'billing', label: 'Billing' },
  { key: 'themes', label: 'Themes' },
] as const;

/**
 * Settings tab strip. Each tab is a real route so deep links work and
 * server components keep their own data fetching. "My profile" is now
 * the first tab + the default landing (/settings → /settings/profile).
 */
export function SettingsTabsNav({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const pathname = usePathname() ?? '';
  const base = `/t/${tenantSlug}/settings`;

  return (
    <div className="flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => {
        const href = `${base}/${tab.key}`;
        const active = pathname.startsWith(href);
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
