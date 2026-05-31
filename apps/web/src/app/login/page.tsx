import Link from 'next/link';
import { Suspense } from 'react';

import { GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { SsoButton } from '@/components/auth/sso-button';
import { isAuth0Configured } from '@/server/auth/auth0';
import { getSiteBranding } from '@/server/integrations/site-branding';
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

// Read env at request time, not build time — AUTH0_* are toggled in
// Vercel without redeploying, so the SSO branch needs to reflect the
// latest values.
export const dynamic = 'force-dynamic';

/**
 * Phase 5.5 M1 — login page.
 *
 * Email/password is the primary tenant sign-in path. Google OAuth
 * (Supabase) is offered alongside it. SSO via G-Suite (Auth0) is
 * surfaced above the others when configured — useful for orgs that
 * have a working G-Suite link — but it's optional, not required.
 *
 * (The Phase 5 design where password was a "staff fallback" behind
 * STAFF_PASSWORD_AUTH_ENABLED was abandoned when G-Suite integration
 * was paused; password is first-class now.)
 */
export default async function LoginPage(): Promise<JSX.Element> {
  const ssoAvailable = isAuth0Configured();
  // Phase 5.6 M5: pull login logo + tagline from SiteBrandingSettings.
  const branding = await getSiteBranding();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {branding.loginPageLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.loginPageLogoUrl}
              alt={branding.appName}
              className="mx-auto mb-3 max-h-12 w-auto"
            />
          )}
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            {branding.loginPageTagline ?? `Sign in to your ${branding.appName} workspace.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ssoAvailable && (
            <>
              <SsoButton />
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
                  or
                </span>
              </div>
            </>
          )}

          <GoogleButton />
          <Suspense>
            <LoginForm />
          </Suspense>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          <span>
            Don&apos;t have a workspace?{' '}
            <Link
              href="/signup"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create one
            </Link>
          </span>
        </CardFooter>
      </Card>
    </main>
  );
}
