'use client';

import Link from 'next/link';
import { Filter, Mail, UploadCloud, UserPlus } from 'lucide-react';

/**
 * Four big CTAs that most new tenants will reach for first. Lime
 * hover tone matches the brand primary. Full-width 2×2 on small
 * screens, 4-across on wider.
 */
export function QuickActionsWidget({ tenantSlug }: { tenantSlug: string; days: number }): JSX.Element {
  const actions = [
    {
      label: 'New campaign',
      icon: Mail,
      href: `/t/${tenantSlug}/campaigns/new`,
      color: 'bg-emerald-500 text-white hover:bg-emerald-600',
    },
    {
      label: 'New segment',
      icon: Filter,
      href: `/t/${tenantSlug}/segments/new`,
      color: 'bg-white text-foreground border hover:bg-lime-50 dark:bg-card dark:hover:bg-lime-950/30',
    },
    {
      label: 'Import contacts',
      icon: UploadCloud,
      href: `/t/${tenantSlug}/contacts?import=1`,
      color: 'bg-white text-foreground border hover:bg-lime-50 dark:bg-card dark:hover:bg-lime-950/30',
    },
    {
      label: 'Invite teammate',
      icon: UserPlus,
      href: `/t/${tenantSlug}/settings/team`,
      color: 'bg-white text-foreground border hover:bg-lime-50 dark:bg-card dark:hover:bg-lime-950/30',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.label}
            href={a.href}
            className={`flex flex-col items-start gap-2 rounded-lg p-3 text-sm font-medium transition-all hover:shadow-sm ${a.color}`}
          >
            <Icon className="size-5" />
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
