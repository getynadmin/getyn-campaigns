import { prisma, type User } from '@getyn/db';

import { createSupabaseServerClient } from './supabase-server';

/**
 * Resolve the current user for the active request.
 *
 * Returns `null` if:
 *   - the request has no Supabase session, OR
 *   - the Supabase session points at a user with no matching `User` row in
 *     our database (can happen mid-signup before the DB row is provisioned)
 *
 * The result includes the minimal profile we need across the app (id, email,
 * name, avatarUrl). Full membership data is fetched separately in the tRPC
 * context to avoid a join when we don't need it.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();

  if (!supabaseUser) return null;

  const user = await prisma.user.findUnique({
    where: { supabaseUserId: supabaseUser.id },
  });
  return user;
}
