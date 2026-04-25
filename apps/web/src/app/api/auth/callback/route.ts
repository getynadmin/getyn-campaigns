import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/server/auth/supabase-server';

/**
 * OAuth callback for Supabase (Google today, more later).
 *
 * Supabase redirects here with `?code=...`; we exchange that code for a
 * session using the server client, which writes Set-Cookie onto the
 * response. After that we bounce to `?next` (if safe) or the root
 * post-auth router, which decides between `/welcome` and `/t/[slug]`.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/';

  if (!code) {
    return NextResponse.redirect(
      new URL('/login?error=missing_code', request.url),
    );
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
