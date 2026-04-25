import type { SubscriptionStatusValue } from '@getyn/types';

import { cn } from '@/lib/utils';

const TONE: Record<SubscriptionStatusValue, string> = {
  SUBSCRIBED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  UNSUBSCRIBED: 'bg-muted text-muted-foreground',
  BOUNCED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  COMPLAINED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  PENDING: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
};

const LABEL: Record<SubscriptionStatusValue, string> = {
  SUBSCRIBED: 'Subscribed',
  UNSUBSCRIBED: 'Unsubscribed',
  BOUNCED: 'Bounced',
  COMPLAINED: 'Complained',
  PENDING: 'Pending',
};

export function StatusBadge({
  status,
}: {
  status: SubscriptionStatusValue;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        TONE[status],
      )}
    >
      {LABEL[status]}
    </span>
  );
}
