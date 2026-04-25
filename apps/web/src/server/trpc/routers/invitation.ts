import { TRPCError } from '@trpc/server';
import { prisma, Role } from '@getyn/db';
import { emailSchema, roleSchema } from '@getyn/types';
import { z } from 'zod';

import { sendEmail } from '@/server/email/resend';
import { buildInviteEmail } from '@/server/email/templates';
import {
  generateInviteToken,
  inviteExpiryDate,
  inviteStatus,
} from '@/server/invite-token';
import {
  createTRPCRouter,
  enforceRole,
  protectedProcedure,
  publicProcedure,
  tenantProcedure,
} from '../trpc';

export const invitationRouter = createTRPCRouter({
  /** List pending (unaccepted, unexpired) invitations for the current workspace. */
  listPending: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    return prisma.invitation.findMany({
      where: {
        tenantId: ctx.tenantContext.tenant.id,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      include: { invitedBy: true },
      orderBy: { createdAt: 'desc' },
    });
  }),

  /**
   * Create and dispatch a new invitation email.
   * OWNER or ADMIN only. Caller cannot invite someone who is already a member
   * of the workspace. Re-inviting an already-pending email issues a fresh
   * token (effectively resending).
   */
  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(
      z.object({
        email: emailSchema,
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Prevent inviting existing members.
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email },
        include: {
          memberships: { where: { tenantId: ctx.tenantContext.tenant.id } },
        },
      });
      if (existingUser && existingUser.memberships.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'That user is already a member of this workspace.',
        });
      }

      // Revoke any existing pending invite for the same email (re-issue pattern).
      await prisma.invitation.deleteMany({
        where: {
          tenantId: ctx.tenantContext.tenant.id,
          email: input.email,
          acceptedAt: null,
        },
      });

      const invitation = await prisma.invitation.create({
        data: {
          tenantId: ctx.tenantContext.tenant.id,
          email: input.email,
          role: input.role,
          token: generateInviteToken(),
          invitedByUserId: ctx.user.id,
          expiresAt: inviteExpiryDate(),
        },
      });

      await sendEmail(
        buildInviteEmail({
          to: invitation.email,
          inviterName: ctx.user.name ?? ctx.user.email,
          workspaceName: ctx.tenantContext.tenant.name,
          token: invitation.token,
        }),
      );

      return invitation;
    }),

  /** Delete a pending invitation. OWNER or ADMIN only. */
  revoke: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(z.object({ invitationId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const target = await prisma.invitation.findUnique({
        where: { id: input.invitationId },
      });
      if (!target || target.tenantId !== ctx.tenantContext.tenant.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found.' });
      }
      await prisma.invitation.delete({ where: { id: target.id } });
      return { ok: true as const };
    }),

  /**
   * Public lookup by token. Returns safe metadata (email, role, workspace
   * name) plus a status flag; the raw invitation row is never exposed.
   */
  lookup: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const invite = await prisma.invitation.findUnique({
        where: { token: input.token },
        include: { tenant: true },
      });
      const status = inviteStatus(invite);
      if (status !== 'valid') {
        return { status } as const;
      }
      return {
        status: 'valid' as const,
        email: invite!.email,
        role: invite!.role,
        tenant: { slug: invite!.tenant.slug, name: invite!.tenant.name },
      };
    }),

  /**
   * Accept a pending invitation. Must be authenticated and the session's
   * email must match the invitation. Creates the membership and marks the
   * invite as accepted atomically.
   */
  accept: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await prisma.invitation.findUnique({
        where: { token: input.token },
      });
      const status = inviteStatus(invite);
      if (status !== 'valid') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invitation is ${status.replace('_', ' ')}.`,
        });
      }
      if (invite!.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This invitation was sent to a different email address.',
        });
      }

      return prisma.$transaction(async (tx) => {
        const membership = await tx.membership.upsert({
          where: {
            userId_tenantId: { userId: ctx.user.id, tenantId: invite!.tenantId },
          },
          update: { role: invite!.role },
          create: {
            userId: ctx.user.id,
            tenantId: invite!.tenantId,
            role: invite!.role,
          },
        });
        await tx.invitation.update({
          where: { id: invite!.id },
          data: { acceptedAt: new Date() },
        });
        const tenant = await tx.tenant.findUnique({
          where: { id: invite!.tenantId },
        });
        return { membership, tenant };
      });
    }),
});
