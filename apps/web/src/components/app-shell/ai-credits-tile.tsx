'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Compact AI-credits quota tile. Sibling of EmailQuotaTile — same
 * subscription.usage query, different metric. Hides itself if the
 * plan doesn't list AI credits.
 */
export function AiCreditsTile({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element | null {
  const usage = api.subscription.usage.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  if (!usage.data) return null;
  const ai = usage.data.metrics.find(
    (m) => m.metric === 'AI_CREDITS_PER_MONTH',
  );
  if (!ai || ai.limit === 0) return null;

  const { current, limit } = ai;
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
      title="AI credits used this period"
    >
      <Sparkles className="size-3.5 text-violet-500" />
      <span className={cn('tabular-nums', tone)}>
        {current.toLocaleString()}
        {isUnlimited ? (
          <span className="text-foreground/40"> used</span>
        ) : (
          <>
            <span className="text-foreground/40"> / </span>
            {limit.toLocaleString()}
          </>
        )}
      </span>
      <span className="text-[10px] text-foreground/40">AI credits</span>
    </Link>
  );
}
