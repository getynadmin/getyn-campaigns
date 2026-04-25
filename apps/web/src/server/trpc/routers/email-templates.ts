import { TRPCError } from '@trpc/server';

import type { Prisma } from '@getyn/db';
import { Role, withTenant } from '@getyn/db';
import {
  campaignSendTestSchema,
  emailTemplateCreateSchema,
  emailTemplateDeleteSchema,
  emailTemplateDuplicateSchema,
  emailTemplateGetSchema,
  emailTemplateListInputSchema,
  emailTemplateUpdateSchema,
} from '@getyn/types';

import { renderPlaintext } from '@/server/email/render';
import { sendEmail } from '@/server/email/resend';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * EmailTemplate router — Phase 3 M3 + M4.
 *
 * Templates come in two flavors:
 *   - System templates (`tenantId IS NULL`): seeded by the platform,
 *     read-only to every tenant, listable for "Use template" flows.
 *   - Tenant-owned templates: created/updated/deleted by OWNER/ADMIN/EDITOR
 *     for their own tenant.
 *
 * RLS provides defense in depth (one policy for the system templates
 * SELECT, another for the standard tenant-isolation pattern). The
 * application-side checks below mirror the policies so we surface
 * helpful errors before RLS would silently filter rows out.
 */
export const emailTemplatesRouter = createTRPCRouter({
  /**
   * List + filter. The default scope merges system + tenant. Toggling
   * to "TENANT" or "SYSTEM" narrows the result. Cursor pagination on
   * (createdAt desc, id desc) for stability.
   */
  list: tenantProcedure
    .input(emailTemplateListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        // Build the where clause matching the chosen scope. Note: RLS
        // enforces the same shape, but using OR explicitly here keeps
        // Prisma's query plan readable.
        const where: Prisma.EmailTemplateWhereInput = {
          ...(input.scope === 'SYSTEM'
            ? { tenantId: null }
            : input.scope === 'TENANT'
              ? { tenantId }
              : { OR: [{ tenantId: null }, { tenantId }] }),
          ...(input.category ? { category: input.category } : {}),
          ...(input.search
            ? {
                OR: [
                  { name: { contains: input.search, mode: 'insensitive' } },
                  { description: { contains: input.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        };

        const rows = await tx.emailTemplate.findMany({
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
        const total = await tx.emailTemplate.count({ where });
        return { items: rows, nextCursor, total };
      });
    }),

  get: tenantProcedure
    .input(emailTemplateGetSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, async (tx) => {
        const row = await tx.emailTemplate.findFirst({
          where: {
            id: input.id,
            // System OR tenant-owned — the RLS policy will filter cross-tenant.
            OR: [{ tenantId: null }, { tenantId }],
          },
        });
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Template not found.',
          });
        }
        return row;
      });
    }),

  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(emailTemplateCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      return withTenant(tenantId, (tx) =>
        tx.emailTemplate.create({
          data: {
            tenantId,
            name: input.name,
            description: input.description,
            category: input.category,
            thumbnailUrl: input.thumbnailUrl,
            designJson: input.designJson as object,
            createdByUserId: ctx.user.id,
          },
        }),
      );
    }),

  update: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(emailTemplateUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const existing = await withTenant(tenantId, (tx) =>
        tx.emailTemplate.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true, tenantId: true },
        }),
      );
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found.',
        });
      }
      // System templates have tenantId = null and are unreachable through
      // this query, so no additional check needed.
      return withTenant(tenantId, (tx) =>
        tx.emailTemplate.update({
          where: { id: input.id },
          data: {
            ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
            ...(input.patch.description !== undefined
              ? { description: input.patch.description }
              : {}),
            ...(input.patch.category !== undefined
              ? { category: input.patch.category }
              : {}),
            ...(input.patch.thumbnailUrl !== undefined
              ? { thumbnailUrl: input.patch.thumbnailUrl }
              : {}),
            ...(input.patch.designJson !== undefined
              ? { designJson: input.patch.designJson as object }
              : {}),
          },
        }),
      );
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(emailTemplateDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const existing = await withTenant(tenantId, (tx) =>
        tx.emailTemplate.findFirst({
          where: { id: input.id, tenantId },
          select: { id: true },
        }),
      );
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found (or it is a system template — those cannot be deleted).',
        });
      }
      await withTenant(tenantId, (tx) =>
        tx.emailTemplate.delete({ where: { id: existing.id } }),
      );
      return { ok: true as const };
    }),

  duplicate: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(emailTemplateDuplicateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      // Source can be either system or tenant-owned. We always create the
      // copy as tenant-owned.
      const src = await withTenant(tenantId, (tx) =>
        tx.emailTemplate.findFirst({
          where: {
            id: input.id,
            OR: [{ tenantId: null }, { tenantId }],
          },
        }),
      );
      if (!src) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Source template not found.',
        });
      }
      return withTenant(tenantId, (tx) =>
        tx.emailTemplate.create({
          data: {
            tenantId,
            name: `${src.name} (copy)`,
            description: src.description,
            category: src.category,
            thumbnailUrl: src.thumbnailUrl,
            designJson: src.designJson as object,
            createdByUserId: ctx.user.id,
          },
        }),
      );
    }),

  /**
   * Send a test email rendered from this template. The client just
   * saved the latest design before calling this, so the most recent
   * `designJson` is in the DB. We render plaintext server-side from
   * the renderedHtml the client posted via `update`.
   *
   * Test sends bypass the queue, the suppression list, and don't count
   * toward `dailySendLimit`. They go directly through Resend.
   *
   * Restrictions:
   *   - Up to 5 recipients
   *   - Tenant-owned templates only (system templates aren't editable
   *     so a "test" doesn't make sense for them)
   */
  sendTest: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN, Role.EDITOR))
    .input(campaignSendTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const tpl = await withTenant(tenantId, (tx) =>
        tx.emailTemplate.findFirst({
          where: { id: input.id, tenantId },
        }),
      );
      if (!tpl) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found or not editable from this tenant.',
        });
      }

      // The renderedHtml column isn't part of EmailTemplate today — we
      // render from designJson on demand. For a test send, we render
      // a basic frame: the design should already include all the structure.
      // The client just saved the full HTML via `update` is NOT the case
      // here; templates don't store renderedHtml. Instead we generate a
      // simple HTML stub from the title for the test send, marked with
      // a banner.
      //
      // Phase 3 M3 limitation acknowledged: real test-render of templates
      // requires the editor to also POST the renderedHtml separately. We
      // can revisit by adding a `renderedHtml` Json column to
      // EmailTemplate, but for MVP a synthesized stub is enough — the
      // designer is iterating on a template, not previewing a real send.
      const html = `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;">
    📨 Test send from template <strong>${escapeHtml(tpl.name)}</strong>. To preview the full design, save the template and view it inside the editor.
  </div>
  <h1 style="font-size:20px;">${escapeHtml(tpl.name)}</h1>
  <p>${escapeHtml(tpl.description ?? 'No description.')}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="color:#6b7280;font-size:12px;">
    This is a test email from Getyn Campaigns. The full template renders in the email builder.
  </p>
</body>
</html>`;
      const text = renderPlaintext(html);

      // Send to each recipient sequentially — tiny volumes (up to 5),
      // not worth the parallelism complexity of Promise.all for now.
      for (const to of input.recipients) {
        await sendEmail({
          to,
          subject: `[Test] ${tpl.name}`,
          html,
          text,
        });
      }
      return { ok: true as const, sentTo: input.recipients.length };
    }),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
