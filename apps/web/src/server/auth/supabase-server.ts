import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';

/**
 * Supabase client bound to the current request's cookies. Call this from
 * server components, route handlers, and tRPC procedures. It can both read
 * the session and write refreshed cookies back to the response.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // `cookies().set` throws from Server Components (as opposed to
          // route handlers and server actions). The middleware handles
          // session refresh in that case, so we can safely swallow here.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // See comment in `set` above.
        }
      },
    },
  });
}
