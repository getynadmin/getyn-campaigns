import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Auth middleware.
 *
 *  1. Refresh the Supabase session every request, writing rotated cookies
 *     onto the response so downstream handlers + the browser stay in sync.
 *  2. Block unauthenticated access to `/t/[slug]/*` by redirecting to
 *     `/login?next=<original-path>`.
 *  3. Bounce authenticated users away from `/login` and `/signup`
 *     back to `/`, which does its own post-auth routing.
 *
 * Membership verification — "is this user actually allowed in this tenant?" —
 * does NOT happen here: Prisma is not safe in the Edge runtime. Each tenant
 * layout runs that check as a server component and 404s on mismatch.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isAuthPath = pathname === '/login' || pathname === '/signup';
  const isTenantPath = pathname.startsWith('/t/');

  if (!user && isTenantPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isAuthPath) {
    const root = request.nextUrl.clone();
    root.pathname = '/';
    root.search = '';
    return NextResponse.redirect(root);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals, static assets, and the tRPC endpoint
    // (tRPC runs its own auth checks via procedures).
    '/((?!_next/static|_next/image|favicon.ico|api/trpc|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
