import Link from 'next/link';
import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';

import { GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { SsoButton } from '@/components/auth/sso-button';
import { isAuth0Configured } from '@/server/auth/auth0';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Log in',
};

// Read env at request time, not build time — STAFF_PASSWORD_AUTH_ENABLED
// + AUTH0_* are mutable in Vercel without redeploying, so the rendered
// branches need to reflect the latest values.
export const dynamic = 'force-dynamic';

/**
 * Phase 5 M1 — login page.
 *
 * Three paths visible based on env config:
 *   - SSO via G-Suite (Auth0). Default + recommended for paying tenants.
 *   - Google OAuth via Supabase. Phase 1 fallback; useful in dev.
 *   - Email/password. Behind STAFF_PASSWORD_AUTH_ENABLED flag in prod;
 *     for staff fallback during incidents.
 *
 * The page shape adapts to which surfaces are available so we don't
 * render dead buttons.
 */
export default function LoginPage(): JSX.Element {
  const ssoAvailable = isAuth0Configured();
  // Default off in prod so the password form is hidden by default.
  const staffPasswordEnabled =
    process.env.STAFF_PASSWORD_AUTH_ENABLED === 'true';

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            {ssoAvailable
              ? 'Sign in with your G-Suite account.'
              : 'Sign in to your Getyn workspace.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ssoAvailable && <SsoButton />}

          {/* Show the Phase 1 paths only when explicitly enabled (dev
              + staff fallback). In prod with SSO live, the page is
              SSO-only — no separator, no Google, no password. */}
          {staffPasswordEnabled && (
            <>
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
                  or staff fallback
                </span>
              </div>
              <GoogleButton />
              <Suspense>
                <LoginForm />
              </Suspense>
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <ShieldCheck className="mr-1 inline size-3" />
                Email/password is staff-only. Customers sign in via G-Suite.
              </p>
            </>
          )}

          {!ssoAvailable && !staffPasswordEnabled && (
            <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm">
              <p className="font-medium">Sign-in surfaces aren&apos;t configured.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Set <code className="rounded bg-muted px-1">AUTH0_DOMAIN</code>
                {' '}+ <code className="rounded bg-muted px-1">AUTH0_CLIENT_ID</code>
                {' '}or enable{' '}
                <code className="rounded bg-muted px-1">STAFF_PASSWORD_AUTH_ENABLED=true</code>.
              </p>
            </div>
          )}

          {/* Fallback for dev when neither flag/secret is on but we still
              want Phase 1 paths to work (so onboarding doesn't break). */}
          {!ssoAvailable && !staffPasswordEnabled && (
            <Button variant="outline" asChild className="w-full">
              <Link href="/signup">Create a workspace</Link>
            </Button>
          )}
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          <span>
            {ssoAvailable ? (
              'Customer accounts are managed in G-Suite.'
            ) : (
              <>
                Don&apos;t have a workspace?{' '}
                <Link
                  href="/signup"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Create one
                </Link>
              </>
            )}
          </span>
        </CardFooter>
      </Card>
    </main>
  );
}
