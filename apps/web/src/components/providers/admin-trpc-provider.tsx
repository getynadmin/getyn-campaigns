'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { useState } from 'react';
import superjson from 'superjson';

import { adminApi } from '@/lib/admin-trpc';

/**
 * Phase 5 M7 — admin tRPC + React Query provider.
 *
 * Mounted at the /admin layout (only there). Hits /api/admin-trpc;
 * fails closed via the server-side staffProcedure gate when the
 * staff cookie is missing.
 */
export function AdminTrpcProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15 * 1000, // shorter than customer side — staff want fresh data
            refetchOnWindowFocus: true,
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  const [client] = useState(() =>
    adminApi.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
        }),
        httpBatchLink({
          url: '/api/admin-trpc',
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <adminApi.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </adminApi.Provider>
  );
}
