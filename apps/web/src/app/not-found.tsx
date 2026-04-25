import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        That URL doesn&apos;t match any page in your workspace.
      </p>
      <Button asChild className="mt-8" variant="outline">
        <Link href="/">
          <ArrowLeft className="size-4" />
          Back to start
        </Link>
      </Button>
    </main>
  );
}
