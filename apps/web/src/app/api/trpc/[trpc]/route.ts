import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter } from '@/server/trpc/root';
import { createTRPCContext } from '@/server/trpc/context';

export const dynamic = 'force-dynamic';
// Vercel serverless timeout — default is 10s, which was tripping 504s
// on slower mutations (e.g. imports.start with tenant limit checks
// against a large contact table, automation.enrollFromSegment with
// paginated cursor scans). 60s is the Pro-tier cap; anything longer
// belongs in a background worker.
export const maxDuration = 60;

async function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError:
      process.env.NODE_ENV === 'development'
        ? ({ path, error }) => {
            // eslint-disable-next-line no-console
            console.error(`[trpc] ${path ?? '<no-path>'}: ${error.message}`);
          }
        : undefined,
  });
}

export { handler as GET, handler as POST };
