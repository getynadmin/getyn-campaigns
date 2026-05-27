import { createTRPCReact } from '@trpc/react-query';
import type { inferRouterOutputs } from '@trpc/server';

import type { AdminRouter } from '@/server/trpc/admin-root';

/**
 * Phase 5 M7 — admin tRPC client.
 *
 * Separate from `api` (the customer client) so we can't accidentally
 * cross-call between surfaces. The admin client only mounts under
 * /admin/* via the AdminTrpcProvider in that layout.
 */
export const adminApi = createTRPCReact<AdminRouter>();

export type AdminRouterOutputs = inferRouterOutputs<AdminRouter>;
