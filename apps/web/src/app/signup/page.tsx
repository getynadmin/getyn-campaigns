import Link from 'next/link';
import { Suspense } from 'react';

import { AuthLayout } from '@/components/auth/auth-layout';
import { SignupFormLight } from '@/components/auth/signup-form-light';

export const metadata = {
  title: 'Create your account',
};

export const dynamic = 'force-dynamic';

/**
 * Phase 5.7 — redesigned /signup.
 *
 * Two-column shell: light left (form), animated marketing panel right.
 * Form logic untouched — calls trpc.signup.create, routes into the
 * new workspace on success.
 */
export default async function SignupPage(): Promise<JSX.Element> {
  return (
    <AuthLayout theme="light">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Set up your workspace and start sending campaigns.
        </p>
      </div>

      <div className="mt-8">
        <Suspense>
          <SignupFormLight />
        </Suspense>
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
