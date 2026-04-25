import type { Membership, Role, Tenant, User } from '@getyn/db';

import { getCurrentUser } from '@/server/auth/session';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';

export interface TenantContext {
  tenant: Tenant;
  membership: Membership & { role: Role };
}

export interface TRPCContext {
  user: User | null;
  supabase: ReturnType<typeof createSupabaseServerClient>;
  /** Per-request header accessor, used by the tenant middleware to pull `x-tenant-slug`. */
  headers: Headers;
  /** Resolved lazily by `enforceTenant` from the `x-tenant-slug` header. */
  tenantContext: TenantContext | null;
}

/**
 * Build the per-request tRPC context.
 *
 * The client injects the current workspace slug via the `x-tenant-slug`
 * header (set in the tRPC client link). The tenant row and membership are
 * only fetched inside the `enforceTenant` middleware so that public
 * procedures (signup, invite acceptance) avoid the lookup entirely.
 */
export async function createTRPCContext({ headers }: { headers: Headers }): Promise<TRPCContext> {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser();
  return {
    user,
    supabase,
    headers,
    tenantContext: null,
  };
}
