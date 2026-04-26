import type { SegmentRules } from '@getyn/types';

/**
 * Default starting tree for a new segment — a single AND group with one
 * "email_status equals SUBSCRIBED" condition. Lives in its own file (no
 * `'use client'` directive) so the segments/new server component can call
 * `emptyRules()` without the cross-boundary serialization quirks Next.js
 * has when a Server Component imports a non-component export from a
 * `'use client'` file (works in dev, fails in prod with `(0, x.Y) is not
 * a function`).
 */

const EMPTY_RULES: SegmentRules = {
  kind: 'group',
  operator: 'AND',
  children: [
    {
      kind: 'condition',
      field: 'email_status',
      operator: 'equals',
      value: 'SUBSCRIBED',
    },
  ],
};

export function emptyRules(): SegmentRules {
  // Deep-clone so callers can mutate without sharing references.
  return JSON.parse(JSON.stringify(EMPTY_RULES)) as SegmentRules;
}
