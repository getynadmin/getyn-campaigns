import Link from 'next/link';
import { Suspense } from 'react';

import { GoogleButton } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
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

export default function LoginPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Log in to your Getyn workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <GoogleButton />
          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
              or
            </span>
          </div>
          {/* LoginForm uses useSearchParams, which requires a Suspense
              boundary under the App Router. */}
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
