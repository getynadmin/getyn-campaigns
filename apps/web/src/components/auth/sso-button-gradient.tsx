'use client';

import { Sparkles } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

/**
 * Phase 5.7 — gradient SSO CTA for the new /login design.
 *
 * Server-side AUTH0_DOMAIN gate is already enforced by the parent
 * page (only renders this when isAuth0Configured() is true).
 */
export function SsoButtonGradient(): JSX.Element {
  const params = useSearchParams();
  const next = params.get('next');
  const href =
    '/api/auth/login/auth0' +
    (next ? `?return_to=${encodeURIComponent(next)}` : '');
  return (
    <a
      href={href}
      className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/30 transition-all hover:shadow-fuchsia-900/50"
    >
      <span
        aria-hidden
        className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-[100%]"
      />
      <Sparkles className="size-4" />
      Continue with Getyn SSO
    </a>
  );
}
