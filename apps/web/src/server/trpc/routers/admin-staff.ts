import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { StaffRole, prisma } from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5 M7 — admin.staff.*
 *
 * Manage who has staff access. SUPPORT_ADMIN can invite/remove/
 * change-role; SUPPORT can only list. Bootstrap of the first
 * SUPPORT_ADMIN happens via INITIAL_STAFF_EMAILS env (see
 * @/server/admin/bootstrap).
 *
 * No password/credential management here — staff authenticate via
 * Auth0 SSO. Adding an email to StaffUser is what grants access.
 */

const emailSchema = z.object({ email: z.string().trim().email().toLowerCase() });
const inviteSchema = emailSchema.extend({
  role: z.enum(['SUPPORT', 'SUPPORT_ADMIN']),
});

export const adminStaffRouter = createAdminRouter({
  list: staffProcedure.query(async () => {
    return prisma.staffUser.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }),

  invite: supportAdminProcedure
    .input(inviteSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const existing = await tx.staffUser.findUnique({
          where: { email: input.email },
        });
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This email is already a staff member.',
          });
        }
        const created = await tx.staffUser.create({
          data: {
            email: input.email,
            role: input.role as StaffRole,
            createdBy: ctx.staff.staffUserId,
          },
        });
        return {
          result: created,
          audit: {
            action: 'admin.staff.invite',
            targetEntityId: created.id,
            afterSnapshot: { email: created.email, role: created.role },
          },
        };
      });
    }),

  remove: supportAdminProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const target = await tx.staffUser.findUnique({
          where: { id: input.id },
        });
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        if (target.id === ctx.staff.staffUserId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'You cannot remove yourself. Ask another SUPPORT_ADMIN to remove you.',
          });
        }
        // Last-admin invariant: refuse to remove the last SUPPORT_ADMIN.
        if (target.role === StaffRole.SUPPORT_ADMIN) {
          const remaining = await tx.staffUser.count({
            where: {
              role: StaffRole.SUPPORT_ADMIN,
              id: { not: target.id },
            },
          });
          if (remaining === 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'At least one SUPPORT_ADMIN must remain.',
            });
          }
        }
        await tx.staffUser.delete({ where: { id: target.id } });
        return {
          result: { ok: true as const },
          audit: {
            action: 'admin.staff.remove',
            targetEntityId: target.id,
            beforeSnapshot: { email: target.email, role: target.role },
          },
        };
      });
    }),
});
