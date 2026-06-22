import Link from 'next/link';
import { Suspense } from 'react';

import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginFormDark } from '@/components/auth/login-form-dark';
import { SilentSsoProbe } from '@/components/auth/silent-sso-probe';
import { SsoButtonGradient } from '@/components/auth/sso-button-gradient';
import { isAuth0Configured } from '@/server/auth/auth0';

export const metadata = {
  title: 'Log in',
};

// Read env at request time — AUTH0_* are toggled in Vercel without
// redeploying, so the SSO branch needs to reflect the latest values.
export const dynamic = 'force-dynamic';

/**
 * Phase 5.7 — redesigned /login.
 *
 * Two-column shell: dark left (form), animated marketing panel right.
 * Password is the primary tenant sign-in path; SSO sits above it as a
 * gradient CTA when AUTH0_DOMAIN is set. Logic is unchanged from
 * Phase 5.5 M1 — only visuals.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    logged_out?: string;
    next?: string;
    sso?: string;
    sso_error?: string;
  };
}): Promise<JSX.Element> {
  // Older AdminCentral links may hit /login?sso=… instead of
  // /sso?sso=… Forward straight to the verifier route so the token
  // still consumes — skip the /sso dispatcher hop.
  if (searchParams.sso) {
    const { redirect } = await import('next/navigation');
    redirect(`/api/sso/consume?sso=${encodeURIComponent(searchParams.sso)}`);
  }
  const ssoAvailable = isAuth0Configured();
  // Skip the silent probe when the user just signed out (or hit an
  // SSO error) — otherwise we'd loop them straight back in.
  const silentEligible =
    ssoAvailable && !searchParams.logged_out && !searchParams.error;
  return (
    <AuthLayout theme="dark">
      <SilentSsoProbe
        enabled={silentEligible}
        returnTo={searchParams.next ?? null}
      />
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-sm text-white/65">
          Sign in to continue to your workspace.
        </p>
      </div>

      <div className="mt-8 space-y-5">
        {ssoAvailable && (
          <>
            <Suspense>
              <SsoButtonGradient />
            </Suspense>
            <Divider label="Or sign in with password" />
          </>
        )}

        <Suspense>
          <LoginFormDark />
        </Suspense>
      </div>

      <p className="mt-8 text-center text-sm text-white/65">
        Don&apos;t have an account?{' '}
        <Link
          href="/signup"
          className="font-medium text-white underline-offset-4 hover:underline"
        >
          Register here
        </Link>
      </p>
    </AuthLayout>
  );
}

function Divider({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-white/10" />
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
