import { redirect } from 'next/navigation';

import { isAuth0Configured } from '@/server/auth/auth0';

/**
 * Phase 5 M1 — public SSO landing.
 *
 * Most users arrive here from G-Suite ("Open Campaigns" → links to
 * `/sso?return_to=...`). We don't render a UI; just kick off the
 * OAuth dance immediately so the user doesn't see a Campaigns-side
 * intermediate page.
 *
 * If Auth0 isn't configured (local dev without env vars), bounce to
 * /login with an explanatory message.
 */
export const dynamic = 'force-dynamic';

export default function SsoPage({
  searchParams,
}: {
  searchParams?: { return_to?: string };
}): never {
  if (!isAuth0Configured()) {
    redirect('/login?error=sso_disabled');
  }
  const returnTo = searchParams?.return_to;
  const target = returnTo
    ? `/api/auth/login/auth0?return_to=${encodeURIComponent(returnTo)}`
    : '/api/auth/login/auth0';
  redirect(target);
}
