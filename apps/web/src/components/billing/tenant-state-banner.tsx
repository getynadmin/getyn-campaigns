import { AlertTriangle, ExternalLink, ShieldOff } from 'lucide-react';

import type { TenantOperationalState } from '@/server/billing/tenant-state';
import { cn } from '@/lib/utils';

/**
 * Phase 5 M4 — tenant operational-state banner.
 *
 * Mounted at the top of every tenant page. Renders nothing for
 * ACTIVE — only surfaces when writes are blocked or the workspace
 * is in a degraded state. Server-rendered (state derived in the
 * tenant layout), so first paint is correct.
 *
 * # When each variant shows
 *   READ_ONLY  → amber. "Subscription canceled. Read-only until {date}."
 *   SUSPENDED  → red. "Workspace suspended. Reactivate in G-Suite."
 *   PURGING    → red. "Workspace deletion in progress."
 *
 * "Open G-Suite" deep link uses GSUITE_BASE_URL env (server-side
 * already inlined at build for the page that calls this).
 */
export function TenantStateBanner({
  state,
}: {
  state: TenantOperationalState;
}): JSX.Element | null {
  if (state.mode === 'ACTIVE') return null;

  const gSuiteUrl = process.env.NEXT_PUBLIC_GSUITE_BASE_URL ?? 'https://getyn.com';

  const tone = {
    READ_ONLY:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    SUSPENDED:
      'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
    PURGING:
      'border-rose-400 bg-rose-100 text-rose-950 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-50',
  }[state.mode];

  const Icon =
    state.mode === 'READ_ONLY' ? AlertTriangle : ShieldOff;

  return (
    <div
      className={cn(
        'mb-4 flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm',
        tone,
      )}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">{titleFor(state.mode)}</p>
          <p className="mt-0.5 text-xs opacity-90">
            {state.reason}
            {state.readOnlyUntil && (
              <>
                {' '}Grace period ends{' '}
                <strong>
                  {state.readOnlyUntil.toLocaleDateString()}
                </strong>
                .
              </>
            )}
          </p>
        </div>
      </div>
      {state.mode !== 'PURGING' && (
        <a
          href={`${gSuiteUrl}/billing`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-current/40 px-2 py-1 text-xs font-medium transition-colors hover:bg-current/10"
        >
          Manage in G-Suite
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function titleFor(mode: TenantOperationalState['mode']): string {
  switch (mode) {
    case 'READ_ONLY':
      return 'Workspace is read-only';
    case 'SUSPENDED':
      return 'Workspace is suspended';
    case 'PURGING':
      return 'Workspace deletion in progress';
    case 'ACTIVE':
      return 'Active';
  }
}
