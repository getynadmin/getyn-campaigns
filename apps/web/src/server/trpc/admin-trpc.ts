/**
 * Phase 5 M7 — staff-only tRPC primitives.
 *
 * Separate from the customer tRPC namespace so the gating + the
 * context are unambiguous. Customer procedures use `tenantProcedure`;
 * staff procedures use `staffProcedure`. The router mount is
 * separate too (admin-root.ts ↔ /api/admin-trpc).
 *
 * # Why a second tRPC mount instead of a namespace inside appRouter
 *   1. URL surface clarity — /api/admin-trpc is a separate router
 *      that we can rate-limit, IP-allowlist, or move behind a VPN
 *      independently of the customer API.
 *   2. Type safety — TenantContext (with tenant + membership) is
 *      irrelevant for admin. Building a separate context type prevents
 *      cross-contamination in autocomplete + reduces accidents.
 *   3. Deployability — if we ever want to ship `/admin` as a separate
 *      service, the boundary is already drawn.
 */
import { TRPCError, initTRPC } from '@trpc/server';
import { ZodError } from 'zod';
import superjson from 'superjson';

import type { StaffRole } from '@getyn/db';

import {
  resolveStaffSession,
  type StaffContext,
} from '@/server/admin/staff-session';

export interface AdminContext {
  staff: StaffContext | null;
  headers: Headers;
}

export async function createAdminContext(opts: {
  req: Request | { headers: Headers };
}): Promise<AdminContext> {
  const headers =
    opts.req instanceof Request ? opts.req.headers : opts.req.headers;
  const staff = await resolveStaffSession();
  return { staff, headers };
}

const t = initTRPC.context<AdminContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createAdminRouter = t.router;
export const createAdminCallerFactory = t.createCallerFactory;

/**
 * Base staff procedure. Throws UNAUTHORIZED for any caller without
 * an active staff session. The page-level middleware redirects to
 * /admin/login before we get here, so this is defence in depth for
 * direct API calls that bypass page navigation.
 */
export const staffProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.staff) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Staff session required.',
    });
  }
  return next({ ctx: { ...ctx, staff: ctx.staff } });
});

/**
 * Higher-privilege procedure: only SUPPORT_ADMIN may call.
 * Used by staff-management routes (invite/remove staff).
 */
export const supportAdminProcedure = staffProcedure.use(
  async ({ ctx, next }) => {
    if ((ctx.staff.role satisfies StaffRole) !== 'SUPPORT_ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Action requires SUPPORT_ADMIN role.',
      });
    }
    return next({ ctx });
  },
);
