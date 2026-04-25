import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazily-constructed Supabase admin client for the worker. Uses the
 * service-role key so the download call bypasses Storage RLS and can
 * fetch any tenant's import CSV (RLS is a UI defense — worker jobs
 * already prove tenancy via the ImportJob row they're processing).
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[worker] Supabase credentials missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to process imports.',
    );
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
