'use client';

import { useSearchParams } from 'next/navigation';
import { LogIn } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Phase 5 M1 — "Sign in with G-Suite" button.
 *
 * Just a styled anchor → `/api/auth/login/auth0`. Forwards the
 * current page's `?return_to=...` (when set by middleware redirecting
 * an unauthenticated user) so SSO lands you back where you started.
 *
 * Renders nothing client-only-state — safe inside Suspense, no
 * hydration mismatch concerns.
 */
export function SsoButton(): JSX.Element {
  const params = useSearchParams();
  const returnTo = params.get('return_to');
  const href = returnTo
    ? `/api/auth/login/auth0?return_to=${encodeURIComponent(returnTo)}`
    : '/api/auth/login/auth0';

  return (
    <Button asChild className="w-full" size="lg">
      <a href={href}>
        <LogIn className="mr-2 size-4" />
        Sign in with G-Suite
      </a>
    </Button>
  );
}
