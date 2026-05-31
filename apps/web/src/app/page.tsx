import { permanentRedirect, redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/server/auth/supabase-server';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@getyn/db';

export const dynamic = 'force-dynamic';

const MARKETING_URL = 'https://getyn.com/apps/campaigns';

/**
 * The root is a router, not a landing page:
 *
 *   - No Supabase session           → permanent redirect to the
 *                                     marketing site at getyn.com.
 *                                     Phase 5.7: dropped the in-app
 *                                     marketing splash; getyn.com is
 *                                     the single source of pre-signup
 *                                     content.
 *   - Supabase session, no DB User  → `/welcome` to provision their
 *                                     first workspace (OAuth path).
 *   - Supabase session, DB User,
 *     no membership                 → `/welcome` (edge case, rare).
 *   - Supabase session + membership → first workspace dashboard.
 */
export default async function Home(): Promise<JSX.Element> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    // 308 — search engines and the browser cache this as permanent.
    permanentRedirect(MARKETING_URL);
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect('/welcome');
  }
  const first = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { tenant: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!first) {
    redirect('/welcome');
  }
  redirect(`/t/${first.tenant.slug}/dashboard`);
}
