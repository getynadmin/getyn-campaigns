'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';

/**
 * Supabase client for the browser. Reads its credentials from `NEXT_PUBLIC_*`
 * env vars, which are inlined by Next during the client bundle.
 *
 * Session state (the Supabase access + refresh token pair) is stored in
 * cookies managed by `@supabase/ssr`, so it is visible to the matching
 * server client — avoid duplicating sessions in localStorage.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey());
}
