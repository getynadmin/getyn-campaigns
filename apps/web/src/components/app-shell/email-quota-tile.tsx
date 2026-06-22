'use client';

import Link from 'next/link';
import { Mail } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Compact tile in the topbar showing "X / Y emails this month".
 *
 * Fetches usage via the existing subscription router (no new
 * endpoint — emailsSent + plan limit are already exposed there).
 * Hides itself if the subscription query fails so the topbar stays
 * stable on edge auth states.
 */
export function EmailQuotaTile({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element | null {
  const usage = api.subscription.usage.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  if (!usage.data) return null;
  const emails = usage.data.metrics.find(
    (m) => m.metric === 'EMAILS_PER_MONTH',
  );
  if (!emails) return null;

  const { current, limit } = emails;
  // -1 = unlimited; render compact "X used"
  const isUnlimited = limit === -1;
  const pct = isUnlimited ? 0 : limit === 0 ? 100 : (current / limit) * 100;
  const tone =
    pct >= 100
      ? 'text-rose-600 dark:text-rose-300'
      : pct >= 80
        ? 'text-amber-600 dark:text-amber-300'
        : 'text-foreground/70';

  return (
    <Link
      href={`/t/${tenantSlug}/settings/subscription`}
      className="hidden items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/40 md:flex"
      title="Click for plan + quota details"
    >
      <Mail className="size-3.5 text-foreground/60" />
      <span className={cn('tabular-nums', tone)}>
        {current.toLocaleString()}
        {isUnlimited ? (
          <span className="text-foreground/40"> sent</span>
        ) : (
          <>
            <span className="text-foreground/40"> / </span>
            {limit.toLocaleString()}
          </>
        )}
      </span>
      <span className="text-[10px] text-foreground/40">emails / mo</span>
    </Link>
  );
}
