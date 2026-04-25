import { createClient } from '@supabase/supabase-js';

import { publicEnv, serverEnv } from '@/lib/env';

/**
 * Supabase admin client using the service-role key.
 * Required for privileged operations that bypass RLS — e.g. pre-creating
 * users, inviting teammates, or reading any tenant's data from a worker.
 *
 * NEVER import this from a client component. It is gated to server-only
 * modules and will crash at runtime in the browser because the service-role
 * env var is not exposed to `NEXT_PUBLIC_*`.
 */
let adminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  adminClient = createClient(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  return adminClient;
}
