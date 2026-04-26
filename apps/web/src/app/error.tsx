'use client';

/* eslint-disable no-console */
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Root-level error boundary. Next.js renders this whenever a Server
 * Component or its descendants throw during the render pass. Without
 * this file, Next falls back to the generic "Application error: a
 * server-side exception has occurred" page that hides the actual
 * error message + stack — making prod debugging painful.
 *
 * What we do instead:
 *   1. console.error the full error so it shows up in Vercel runtime
 *      logs (visible via the runtime-logs MCP).
 *   2. Show the message + digest to the user so they can paste it back
 *      to support / dev for diagnosis.
 *   3. Provide a "Try again" button that reset()s the error boundary.
 *
 * The full stack is intentionally only rendered in non-production —
 * end users don't need to see the path through the codebase.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    console.error(
      `[error.tsx] ${error.name}: ${error.message}\nDigest: ${error.digest ?? '(none)'}\nStack: ${error.stack ?? '(none)'}`,
    );
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page hit an error during render. Try reloading; if it keeps
        happening, share the message + digest below with the dev team.
      </p>
      <div className="mt-6 rounded-lg border bg-muted/30 p-4">
        <p className="font-mono text-xs">
          <span className="font-medium">Error:</span> {error.message}
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Digest: {error.digest}
          </p>
        ) : null}
        {process.env.NODE_ENV !== 'production' && error.stack ? (
          <pre className="mt-3 max-h-64 overflow-auto rounded bg-card p-2 text-[10px]">
            {error.stack}
          </pre>
        ) : null}
      </div>
      <div className="mt-6 flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
      </div>
    </div>
  );
}
