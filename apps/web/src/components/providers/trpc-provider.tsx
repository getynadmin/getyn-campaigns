'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { useState } from 'react';
import superjson from 'superjson';

import { api, getTRPCUrl } from '@/lib/trpc';

/**
 * Client-side tRPC + React Query provider.
 *
 * The caller passes `tenantSlug` when mounting inside a tenant layout —
 * every request then carries `x-tenant-slug`, which `tenantProcedure`
 * resolves server-side. Outside a tenant (login, signup, invite accept),
 * the prop is omitted and no header is attached.
 */
export function TRPCProvider({
  children,
  tenantSlug,
}: {
  children: React.ReactNode;
  tenantSlug?: string;
}): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
        }),
        httpBatchLink({
          url: getTRPCUrl(),
          transformer: superjson,
          headers() {
            const h = new Headers();
            if (tenantSlug) h.set('x-tenant-slug', tenantSlug);
            return Object.fromEntries(h.entries());
          },
        }),
      ],
    }),
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}
