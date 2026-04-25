import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { appRouter } from '@/server/trpc/root';
import { createTRPCContext } from '@/server/trpc/context';

export const dynamic = 'force-dynamic';

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
