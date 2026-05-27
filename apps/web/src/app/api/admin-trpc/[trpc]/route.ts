import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { adminRouter } from '@/server/trpc/admin-root';
import { createAdminContext } from '@/server/trpc/admin-trpc';

/**
 * Phase 5 M7 — admin tRPC mount.
 *
 * Separate from /api/trpc — different router, different context,
 * different audit semantics. Could be IP-allowlisted at the edge
 * later if we want a VPN-gated admin surface.
 */
export const dynamic = 'force-dynamic';

async function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/admin-trpc',
    req,
    router: adminRouter,
    createContext: () => createAdminContext({ req }),
    onError:
      process.env.NODE_ENV === 'development'
        ? ({ path, error }) => {
            // eslint-disable-next-line no-console
            console.error(`[admin-trpc] ${path ?? '<no-path>'}: ${error.message}`);
          }
        : undefined,
  });
}

export { handler as GET, handler as POST };
