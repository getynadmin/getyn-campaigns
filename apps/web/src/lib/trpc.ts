import { createTRPCReact } from '@trpc/react-query';
import type { inferRouterOutputs } from '@trpc/server';

import type { AppRouter } from '@/server/trpc/root';

/** Typed React-Query bindings for every tRPC procedure. */
export const api = createTRPCReact<AppRouter>();

/** Output type helper — concrete row types without ReturnType chains. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** Helper — builds the absolute tRPC URL for a given request origin. */
export function getTRPCUrl(): string {
  if (typeof window !== 'undefined') return '/api/trpc';
  const vercelUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? vercelUrl ?? 'http://localhost:3000';
  return `${appUrl}/api/trpc`;
}
