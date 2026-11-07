'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { UpgradeModal } from '@/components/subscription/upgrade-modal';
import { api } from '@/lib/trpc';

/**
 * Trial status strip rendered above main content. Hides itself when
 * the tenant is not on a trial or the trial is already over.
 */
export function TrialBar(): JSX.Element | null {
  const { data } = api.subscription.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const trial = data?.trial;
  if (!trial?.isOnTrial) return null;
  const days = trial.daysLeft;
  const tone =
    days <= 1
      ? 'bg-rose-600 text-white'
      : days <= 3
        ? 'bg-amber-500 text-amber-950'
        : 'bg-violet-600 text-white';

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-xs sm:text-sm ${tone}`}
    >
      <Sparkles className="size-4" />
      <span className="font-medium">
        Your trial ends in {days} {days === 1 ? 'day' : 'days'}
        {days === 0 ? ' — today' : ''}.
      </span>
      <span className="opacity-90">
        Upgrade now to keep sending without interruption.
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        Upgrade
      </Button>
      <UpgradeModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
