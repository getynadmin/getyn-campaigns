'use client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { TRPCProvider } from './trpc-provider';

/**
 * Top-level providers mounted once in the root layout. Includes tRPC +
 * React Query, Radix Tooltip provider, and Sonner toaster.
 *
 * `tenantSlug` threads through to `TRPCProvider` so every request made
 * inside a `/t/[slug]/*` tree carries the right `x-tenant-slug` header.
 * Outside the tenant tree it's left undefined.
 */
export function Providers({
  children,
  tenantSlug,
}: {
  children: React.ReactNode;
  tenantSlug?: string;
}): JSX.Element {
  return (
    <TRPCProvider tenantSlug={tenantSlug}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      <Toaster />
    </TRPCProvider>
  );
}
