import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { prisma } from '@getyn/db';

import { getSupabaseAdmin } from '@/server/auth/supabase-admin';

import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * My Profile — tenant-private, user-scoped writes only. Every write
 * is for the caller; there is no "edit another user" path here.
 */
export const profileRouter = createTRPCRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    const u = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        authProvider: true,
        supabaseUserId: true,
      },
    });
    if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    return u;
  }),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        avatarUrl: z.string().url().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await prisma.user.update({
        where: { id: ctx.user.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.avatarUrl !== undefined
            ? { avatarUrl: input.avatarUrl }
            : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
        },
      });
      return updated;
    }),

  changePassword: protectedProcedure
    .input(
      z.object({
        newPassword: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { supabaseUserId: true, authProvider: true, email: true },
      });
      if (!user?.supabaseUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This account signs in via SSO — change your password with your identity provider.',
        });
      }
      const admin = getSupabaseAdmin();
      const { error } = await admin.auth.admin.updateUserById(
        user.supabaseUserId,
        { password: input.newPassword },
      );
      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Could not update password.',
        });
      }
      return { ok: true as const };
    }),
});
