import { z } from 'zod';

import { prisma, type Prisma } from '@getyn/db';

import { createAdminRouter, staffProcedure } from '../admin-trpc';

/**
 * Phase 5 M7 — admin.auditLog.
 *
 * Read-only browse of StaffAuditLog. Filterable by action, target
 * tenant, and the staff actor. Append-only — nothing in the
 * codebase issues an UPDATE or DELETE here; staff can never edit
 * the trail.
 */

const listInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  staffUserId: z.string().min(1).max(64).optional(),
  targetTenantId: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(120).optional(),
});

export const adminAuditLogRouter = createAdminRouter({
  list: staffProcedure
    .input(listInputSchema)
    .query(async ({ input }) => {
      const where: Prisma.StaffAuditLogWhereInput = {
        ...(input.staffUserId ? { staffUserId: input.staffUserId } : {}),
        ...(input.targetTenantId ? { targetTenantId: input.targetTenantId } : {}),
        ...(input.action ? { action: { contains: input.action } } : {}),
      };
      const rows = await prisma.staffAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const next = rows.pop();
        nextCursor = next?.id ?? null;
      }
      return { items: rows, nextCursor };
    }),
});
