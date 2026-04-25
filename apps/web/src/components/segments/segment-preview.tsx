'use client';

import { useEffect, useMemo, useState } from 'react';

import { segmentRulesSchema, type SegmentRules } from '@getyn/types';

import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

/**
 * Live preview of a rule tree — runs tRPC `segments.preview` after a short
 * debounce so a user fiddling with inputs doesn't spam the backend.
 *
 * We run the Zod schema client-side first so we can:
 *   (a) short-circuit the request when the tree is invalid (e.g. a partially
 *       filled condition),
 *   (b) surface a human-readable reason while the user finishes editing.
 */
export function SegmentPreview({ rules }: { rules: SegmentRules }): JSX.Element {
  const debounced = useDebounced(rules, 350);
  const parsed = useMemo(() => segmentRulesSchema.safeParse(debounced), [debounced]);

  const preview = api.segments.preview.useQuery(
    { rules: parsed.success ? parsed.data : debounced, sampleSize: 5 },
    {
      enabled: parsed.success,
      // Preview data changes only when the rule tree does — not on focus.
      refetchOnWindowFocus: false,
    },
  );

  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Finish building the rules to preview.';
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{first}</p>
      </div>
    );
  }

  if (preview.isLoading || preview.isFetching) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <p className="text-sm text-rose-600">
        {preview.error.message ?? 'Could not run preview.'}
      </p>
    );
  }

  const data = preview.data;
  if (!data) return <Skeleton className="h-16 w-full" />;

  return (
    <div className="space-y-3">
      <div>
        <p className="font-display text-2xl font-semibold">
          {data.count.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground">
          contact{data.count === 1 ? '' : 's'} match this segment right now
        </p>
      </div>
      {data.sample.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sample
          </p>
          <ul className="space-y-1">
            {data.sample.map((c) => {
              const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
              const display = name || c.email || c.phone || 'Unnamed';
              return (
                <li key={c.id} className="truncate text-sm">
                  {display}
                  {c.email && name ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {c.email}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
