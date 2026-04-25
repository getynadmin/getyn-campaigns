import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';

import { prisma, type Role } from '@getyn/db';

import type { TRPCContext, TenantContext } from './context';

const t = initTRPC.context<TRPCContext>().create({
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

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * Public procedure — no auth checks. Use sparingly: signup, public invite
 * acceptance, and anything that genuinely has no tenant.
 */
export const publicProcedure = t.procedure;

/**
 * Auth-gated procedure. Requires a logged-in user but does not resolve a
 * tenant. Good for "list my workspaces" and "create a workspace" flows.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required.' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Tenant-scoped procedure. Reads `x-tenant-slug` from the request, loads the
 * tenant and the caller's membership, and throws FORBIDDEN if the user
 * is not a member.
 *
 * Downstream procedures see `ctx.tenantContext` populated and guaranteed
 * non-null.
 */
export const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const slug = ctx.headers.get('x-tenant-slug');
  if (!slug) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Missing x-tenant-slug header.',
    });
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found.' });
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: ctx.user.id, tenantId: tenant.id } },
  });
  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this workspace.',
    });
  }

  const tenantContext: TenantContext = { tenant, membership };
  return next({ ctx: { ...ctx, tenantContext } });
});

/**
 * Pure role-check — extracted so we can unit-test the guard without
 * constructing a full tRPC request. Throws FORBIDDEN on mismatch;
 * no-op on match.
 */
export function assertRoleAllowed(current: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(current)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Your role does not permit this action.',
    });
  }
}

/**
 * Role-gated middleware factory.
 *
 * Usage:
 *   tenantProcedure.use(enforceRole('OWNER', 'ADMIN'))
 *     .input(...)
 *     .mutation(...)
 *
 * The middleware ensures the caller's membership role is in the allowlist
 * before running the procedure. Throws FORBIDDEN otherwise.
 *
 * Exposed as a raw middleware (not a pre-wired procedure) so it composes
 * with `tenantProcedure` and any future tenant-scoped procedure variants.
 */
export function enforceRole(...roles: Role[]) {
  return t.middleware(async ({ ctx, next }) => {
    // Rely on `tenantProcedure` having already populated this. The types
    // guarantee it at compile time, but we guard at runtime too.
    const tenantContext = (ctx as TRPCContext).tenantContext;
    if (!tenantContext) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'enforceRole used outside tenantProcedure.',
      });
    }
    assertRoleAllowed(tenantContext.membership.role, roles);
    // Calling `next()` with no ctx override preserves the narrowing that
    // `tenantProcedure` added upstream. `next({ ctx })` would collapse the
    // ctx type back to the root `TRPCContext` and lose the non-null
    // `tenantContext` + `user` fields.
    return next();
  });
}
