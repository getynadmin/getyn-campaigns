import { redirect } from 'next/navigation';

import { isAuth0Configured } from '@/server/auth/auth0';

/**
 * Public SSO landing — dispatches between two integrations:
 *
 *   1. G-Suite via Auth0 (Phase 5 M1). Hit as `/sso?return_to=…` from
 *      Workspace marketplace. Kicks the OAuth dance.
 *   2. AdminCentral signed-token (current phase). Hit as
 *      `/sso?sso=<payload>.<hmac>` from getyn.com/myaccount. Hands
 *      off to /api/sso/consume which verifies, upserts the tenant +
 *      membership, mints a Supabase magic-link, and 302s the browser
 *      into it.
 *
 * Dispatching here keeps `/sso` as the single public entry point
 * regardless of which upstream is sending the user.
 */
export const dynamic = 'force-dynamic';

export default function SsoPage({
  searchParams,
}: {
  searchParams?: { return_to?: string; sso?: string };
}): never {
  // AdminCentral signed-token path.
  if (searchParams?.sso) {
    redirect(`/api/sso/consume?sso=${encodeURIComponent(searchParams.sso)}`);
  }

  // G-Suite / Auth0 path (default when only `return_to` is set, or
  // when the user lands here from the marketplace icon).
  if (!isAuth0Configured()) {
    redirect('/login?error=sso_disabled');
  }
  const returnTo = searchParams?.return_to;
  const target = returnTo
    ? `/api/auth/login/auth0?return_to=${encodeURIComponent(returnTo)}`
    : '/api/auth/login/auth0';
  redirect(target);
}
