'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Phase 8 M7 — one-shot onboarding hint for Automation surfaces.
 *
 * Persisted-dismissed via localStorage under a per-surface key so
 * each of Drip / Email Agent gets its own hint on first landing,
 * independently.
 *
 * Render nothing until we've read localStorage on mount to avoid a
 * flash — the browser storage read is synchronous but we want to
 * defer past the SSR hydration boundary.
 */
export function FirstVisitHint({
  storageKey,
  title,
  children,
}: {
  storageKey: string;
  title: string;
  children: React.ReactNode;
}): JSX.Element | null {
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(storageKey);
      setVisible(dismissed !== '1');
    } catch {
      // localStorage disabled or unavailable — just render the hint
      // rather than crashing.
      setVisible(true);
    }
  }, [storageKey]);

  function dismiss(): void {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (visible !== true) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/40">
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sky-900 dark:text-sky-100">{title}</p>
          <div className="mt-1 text-sky-800 dark:text-sky-200">{children}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-1 -mt-1 shrink-0 text-sky-800 hover:bg-sky-100 dark:text-sky-200 dark:hover:bg-sky-900"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
