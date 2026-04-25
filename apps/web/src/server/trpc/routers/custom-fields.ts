import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { Prisma, Role, withTenant } from '@getyn/db';
import {
  cuidSchema,
  customFieldCreateSchema,
  customFieldUpdateSchema,
} from '@getyn/types';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Custom fields router. Custom fields define the schema for the free-form
 * `Contact.customFields` JSON bag. Keys are slugs, unique per tenant.
 *
 * Type is immutable once created — enforced by `customFieldUpdateSchema`
 * not exposing `type` at all. To change a type, delete and re-create,
 * which forces the operator to think about value coercion.
 */
export const customFieldsRouter = createTRPCRouter({
  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      return tx.customField.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      });
    });
  }),

  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(customFieldCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      // Normalise options: only SELECT stores a non-null bag; others get
      // DbNull. Prisma uses its sentinel instead of plain null for nullable
      // Json columns (see PrismaClient.Prisma.NullableJsonNullValueInput).
      const options: Prisma.InputJsonValue | typeof Prisma.DbNull =
        input.type === 'SELECT' && input.options
          ? (input.options as Prisma.InputJsonValue)
          : Prisma.DbNull;

      return withTenant(tenantId, async (tx) => {
        try {
          return await tx.customField.create({
            data: {
              tenantId,
              key: input.key,
              label: input.label,
              type: input.type,
              options,
            },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'A custom field with this key already exists.',
            });
          }
          throw err;
        }
      });
    }),

  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(customFieldUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.customField.findFirst({
          where: { id: input.id, tenantId },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Custom field not found.',
          });
        }
        // Only SELECT fields accept an options update. For non-SELECT
        // types we leave `options` alone; for SELECT we accept null (=clear)
        // or a new bag (validated by customFieldOptionsSchema upstream).
        const data: Prisma.CustomFieldUpdateInput = {
          ...(input.label !== undefined ? { label: input.label } : {}),
        };
        if (existing.type === 'SELECT' && input.options !== undefined) {
          data.options =
            input.options === null
              ? Prisma.DbNull
              : (input.options as Prisma.InputJsonValue);
        }

        return tx.customField.update({
          where: { id: existing.id },
          data,
        });
      });
    }),

  /**
   * Delete a custom field. The tenant's Contact rows keep the now-orphaned
   * key in their `customFields` JSON until they're next updated; that's
   * fine because (a) reads that ignore the registry will still see the
   * stale key; (b) future writes to the contact will be rejected if they
   * include the deleted key (via `assertCustomFieldsAreRegistered`).
   *
   * Phase 2 accepts this as good enough. Milestone 8 adds an optional
   * "purge from all contacts" sweep behind a confirmation dialog.
   */
  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.customField.findFirst({
          where: { id: input.id, tenantId },
        });
        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Custom field not found.',
          });
        }
        await tx.customField.delete({ where: { id: existing.id } });
        return { ok: true as const };
      });
    }),
});
