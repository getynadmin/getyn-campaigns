import { TRPCError } from '@trpc/server';

import { PlanMetric, Role, withTenant } from '@getyn/db';
import {
  cuidSchema,
  sendingDomainCreateSchema,
  sendingDomainDeleteSchema,
  sendingDomainListInputSchema,
  sendingDomainVerifySchema,
} from '@getyn/types';

import { assertWithinLimit } from '@/server/billing/assert-limit';
import {
  countSendingDomains,
} from '@/server/billing/measure-usage';
import { resolveTenantLimit } from '@/server/billing/resolve-limits';
import {
  createResendDomain,
  deleteResendDomain,
  verifyResendDomain,
} from '@/server/email/resend-domains';

import { createTRPCRouter, enforceRole, tenantProcedure } from '../trpc';

/**
 * SendingDomain router — Phase 3 M2.
 *
 * Lifecycle:
 *   create → Resend creates the domain + returns DNS records (PENDING)
 *   user pastes records into their DNS provider
 *   verify → Resend re-checks; status flips to VERIFIED on success
 *   delete → removes from Resend AND our DB
 *
 * Plan gating: STARTER tenants can list domains (so the page renders) but
 * cannot create them — the upgrade CTA is surfaced in the UI; the server
 * also rejects with a clear message so the gate isn't only client-side.
 *
 * Mutations require OWNER/ADMIN. EDITOR + VIEWER can browse the list (and
 * see DNS records to copy them into a DNS provider) but cannot add/remove.
 */
export const sendingDomainsRouter = createTRPCRouter({
  list: tenantProcedure
    .input(sendingDomainListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const rows = await withTenant(tenantId, async (tx) => {
        const where = {
          tenantId,
          ...(input.status ? { status: input.status } : {}),
        };
        const items = await tx.sendingDomain.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        });
        let nextCursor: string | null = null;
        if (items.length > input.limit) {
          const next = items.pop();
          nextCursor = next?.id ?? null;
        }
        const total = await tx.sendingDomain.count({ where });
        return { items, nextCursor, total };
      });

      // Phase 5.5 M4: gate on resolved CUSTOM_SENDING_DOMAINS limit
      // (was: LegacyPlanTier GROWTH/PRO).  -1 = unlimited.
      const [limit, current] = await Promise.all([
        resolveTenantLimit(tenantId, PlanMetric.CUSTOM_SENDING_DOMAINS),
        countSendingDomains(tenantId),
      ]);
      const canManageDomains = limit === -1 || current < limit;
      return {
        ...rows,
        // Surface plan tier for legacy upgrade-CTA copy. M5 will rewrite
        // the upgrade banner against the limit numbers directly.
        plan: ctx.tenantContext.tenant.legacyPlanTier,
        canManageDomains,
        sendingDomainLimit: limit,
        sendingDomainUsage: current,
      };
    }),

  create: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(sendingDomainCreateSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;

      // Phase 5.5 M4: gate on resolved CUSTOM_SENDING_DOMAINS limit.
      // Throws FORBIDDEN with customer-facing copy on overflow.
      await assertWithinLimit(
        tenantId,
        PlanMetric.CUSTOM_SENDING_DOMAINS,
        1,
      );

      // Reject duplicates early so we don't create on Resend then fail at
      // the DB layer (which would orphan a Resend domain).
      const existing = await withTenant(tenantId, (tx) =>
        tx.sendingDomain.findUnique({
          where: { tenantId_domain: { tenantId, domain: input.domain } },
          select: { id: true },
        }),
      );
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This domain is already added.',
        });
      }

      // Call Resend FIRST, then write the row. If Resend fails, no DB row.
      // If the DB write fails after Resend succeeded, we leak a Resend
      // domain — small operational cost, and the next attempt's CONFLICT
      // check on Resend's side will surface it.
      const result = await createResendDomain(input.domain);

      const created = await withTenant(tenantId, (tx) =>
        tx.sendingDomain.create({
          data: {
            tenantId,
            domain: input.domain,
            resendDomainId: result.resendDomainId,
            status: result.status,
            dnsRecords: result.dnsRecords as object,
            lastCheckedAt: new Date(),
          },
        }),
      );
      return created;
    }),

  verify: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(sendingDomainVerifySchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await withTenant(tenantId, (tx) =>
        tx.sendingDomain.findFirst({
          where: { id: input.id, tenantId },
        }),
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sending domain not found.',
        });
      }
      if (!row.resendDomainId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Domain has no Resend id — recreate it. (Likely created in dev stub mode.)',
        });
      }

      const result = await verifyResendDomain(row.resendDomainId);

      const updated = await withTenant(tenantId, (tx) =>
        tx.sendingDomain.update({
          where: { id: row.id },
          data: {
            status: result.status,
            verifiedAt: result.verifiedAt,
            dnsRecords: result.dnsRecords as object,
            lastCheckedAt: new Date(),
          },
        }),
      );
      return updated;
    }),

  delete: tenantProcedure
    .use(enforceRole(Role.OWNER, Role.ADMIN))
    .input(sendingDomainDeleteSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await withTenant(tenantId, (tx) =>
        tx.sendingDomain.findFirst({
          where: { id: input.id, tenantId },
        }),
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sending domain not found.',
        });
      }

      // Remove from Resend FIRST. If we fail here, the user can retry —
      // the row is still in our DB, status unchanged.
      if (row.resendDomainId) {
        await deleteResendDomain(row.resendDomainId);
      }

      // Remove our row (cascades to any EmailCampaign that referenced it
      // via sendingDomainId — those land in `null`, falling back to the
      // shared sending pool). No campaigns reference SendingDomain at
      // delete time today because none have been sent yet, but the FK
      // is `ON DELETE SET NULL` exactly to handle this.
      await withTenant(tenantId, (tx) =>
        tx.sendingDomain.delete({ where: { id: row.id } }),
      );
      return { ok: true as const };
    }),

  /**
   * Single-row read used by detail pages / refreshes. Same shape as `list`
   * but for one domain.
   */
  get: tenantProcedure
    .input((input: unknown) => {
      // Inline parse so we don't need a separate Zod export for one field.
      const parsed = cuidSchema.safeParse(
        (input as { id?: unknown } | undefined)?.id,
      );
      if (!parsed.success) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid id.' });
      }
      return { id: parsed.data };
    })
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantContext.tenant.id;
      const row = await withTenant(tenantId, (tx) =>
        tx.sendingDomain.findFirst({
          where: { id: input.id, tenantId },
        }),
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Sending domain not found.',
        });
      }
      return row;
    }),
});
