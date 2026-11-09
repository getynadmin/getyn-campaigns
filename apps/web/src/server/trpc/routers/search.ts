import { z } from 'zod';

import { prisma } from '@getyn/db';

import { createTRPCRouter, tenantProcedure } from '../trpc';

/**
 * Topbar command-palette search. Returns up to 5 hits per category
 * (campaigns, contacts, templates, segments, automations) for a
 * caller-supplied query. Insensitive substring match on the most
 * useful column per model. Cheap enough to run on every keystroke
 * once debounced on the client.
 */
export const searchRouter = createTRPCRouter({
  query: tenantProcedure
    .input(z.object({ q: z.string().trim().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const { tenant } = ctx.tenantContext;
      const q = input.q;
      const take = 5;

      const [campaigns, contacts, templates, segments, automations] =
        await Promise.all([
          prisma.campaign.findMany({
            where: {
              tenantId: tenant.id,
              name: { contains: q, mode: 'insensitive' },
            },
            select: { id: true, name: true, type: true, status: true },
            orderBy: { updatedAt: 'desc' },
            take,
          }),
          prisma.contact.findMany({
            where: {
              tenantId: tenant.id,
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
              deletedAt: null,
            },
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
            orderBy: { updatedAt: 'desc' },
            take,
          }),
          prisma.emailTemplate.findMany({
            where: {
              tenantId: tenant.id,
              name: { contains: q, mode: 'insensitive' },
            },
            select: { id: true, name: true, category: true },
            orderBy: { updatedAt: 'desc' },
            take,
          }),
          prisma.segment.findMany({
            where: {
              tenantId: tenant.id,
              name: { contains: q, mode: 'insensitive' },
            },
            select: { id: true, name: true, description: true },
            orderBy: { updatedAt: 'desc' },
            take,
          }),
          prisma.automation.findMany({
            where: {
              tenantId: tenant.id,
              name: { contains: q, mode: 'insensitive' },
            },
            select: { id: true, name: true, kind: true, status: true },
            orderBy: { updatedAt: 'desc' },
            take,
          }),
        ]);

      const slug = tenant.slug;
      return {
        campaigns: campaigns.map((c) => ({
          id: c.id,
          title: c.name,
          sub: `${c.type} · ${c.status}`,
          chip: c.type,
          href: `/t/${slug}/campaigns/${c.id}`,
        })),
        contacts: contacts.map((c) => ({
          id: c.id,
          title:
            [c.firstName, c.lastName].filter(Boolean).join(' ') ||
            c.email ||
            c.phone ||
            'Contact',
          sub: c.email ?? c.phone ?? '',
          chip: 'CONTACT',
          href: `/t/${slug}/contacts/${c.id}`,
        })),
        templates: templates.map((t) => ({
          id: t.id,
          title: t.name,
          sub: t.category,
          chip: 'TEMPLATE',
          href: `/t/${slug}/templates/${t.id}/design`,
        })),
        segments: segments.map((s) => ({
          id: s.id,
          title: s.name,
          sub: s.description ?? '',
          chip: 'SEGMENT',
          href: `/t/${slug}/segments/${s.id}`,
        })),
        automations: automations.map((a) => ({
          id: a.id,
          title: a.name,
          sub: `${a.kind} · ${a.status}`,
          chip: a.kind,
          href: `/t/${slug}/automation/drip/${a.id}`,
        })),
      };
    }),
});
