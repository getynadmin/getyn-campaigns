import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  ContactEventType,
  Prisma,
  Role,
  emitContactEvent,
  withTenant,
} from '@getyn/db';
import {
  cuidSchema,
  tagAssignSchema,
  tagCreateSchema,
  tagUpdateSchema,
} from '@getyn/types';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * Tags router. Tags are tenant-scoped labels applied to contacts. The
 * (tenantId, name) unique constraint prevents duplicates; we surface the
 * collision as CONFLICT.
 */
export const tagsRouter = createTRPCRouter({
  /**
   * List every tag plus the count of contacts each one is attached to.
   * The counts power the "× 37 contacts" badge in the sidebar UI.
   */
  list: tenantProcedure.query(async ({ ctx }) => {
    const tenantId = ctx.tenantContext.tenant.id;
    return withTenant(tenantId, async (tx) => {
      return tx.tag.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { contacts: true } } },
      });
    });
  }),

  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(tagCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        try {
          return await tx.tag.create({
            data: {
              tenantId,
              name: input.name,
              color: input.color,
            },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'A tag with this name already exists.',
            });
          }
          throw err;
        }
      });
    }),

  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(tagUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.tag.findFirst({
          where: { id: input.id, tenantId },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag not found.' });
        }
        try {
          return await tx.tag.update({
            where: { id: existing.id },
            data: {
              ...(input.name ? { name: input.name } : {}),
              ...(input.color ? { color: input.color } : {}),
            },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'A tag with this name already exists.',
            });
          }
          throw err;
        }
      });
    }),

  /**
   * Delete a tag. This cascades to `ContactTag` (FK onDelete: Cascade). We
   * deliberately don't emit TAG_REMOVED events for the (potentially many)
   * unlinked contacts — that would be an O(n) write in one transaction.
   * The activity timeline picks it up implicitly via the "tag deleted"
   * system event below.
   */
  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ id: cuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const existing = await tx.tag.findFirst({
          where: { id: input.id, tenantId },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag not found.' });
        }
        await tx.tag.delete({ where: { id: existing.id } });
        return { ok: true as const };
      });
    }),

  /** Attach a tag to a contact. Idempotent — already-linked is a no-op. */
  assign: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(tagAssignSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        // Enforce both sides live in this tenant — RLS covers it, but a
        // direct check gives a nicer error than a generic RLS denial.
        const [contact, tag] = await Promise.all([
          tx.contact.findFirst({
            where: { id: input.contactId, tenantId, deletedAt: null },
          }),
          tx.tag.findFirst({ where: { id: input.tagId, tenantId } }),
        ]);
        if (!contact || !tag) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Contact or tag not found.',
          });
        }
        const existing = await tx.contactTag.findUnique({
          where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
        });
        if (existing) return { ok: true as const, alreadyAssigned: true };
        await tx.contactTag.create({
          data: { contactId: contact.id, tagId: tag.id },
        });
        await emitContactEvent(tx, {
          tenantId,
          contactId: contact.id,
          type: ContactEventType.TAG_ADDED,
          metadata: { tagId: tag.id, tagName: tag.name },
        });
        return { ok: true as const, alreadyAssigned: false };
      });
    }),

  unassign: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(tagAssignSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const [contact, tag] = await Promise.all([
          tx.contact.findFirst({
            where: { id: input.contactId, tenantId },
          }),
          tx.tag.findFirst({ where: { id: input.tagId, tenantId } }),
        ]);
        if (!contact || !tag) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Contact or tag not found.',
          });
        }
        await tx.contactTag
          .delete({
            where: {
              contactId_tagId: { contactId: contact.id, tagId: tag.id },
            },
          })
          .catch((err) => {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2025'
            ) {
              // Already unassigned — treat as a no-op.
              return null;
            }
            throw err;
          });
        await emitContactEvent(tx, {
          tenantId,
          contactId: contact.id,
          type: ContactEventType.TAG_REMOVED,
          metadata: { tagId: tag.id, tagName: tag.name },
        });
        return { ok: true as const };
      });
    }),
});
