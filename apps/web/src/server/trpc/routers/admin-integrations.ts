import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SystemEmailTemplateCategory, prisma } from '@getyn/db';

import { withAdminContext } from '@/server/admin/with-admin-context';
import { appBaseUrl } from '@/server/auth/auth0';
import { sendSystemEmail } from '@/server/email/system-email';
import {
  adminLoadIntegration,
  recordTestResult,
  saveIntegration,
} from '@/server/integrations/credential-store';
import {
  checkWorkerHealth,
  getRailwayWorker,
  type RailwayConfig,
  type RailwaySecrets,
} from '@/server/integrations/railway';
import {
  getResendCredentials,
  testResendCredentials,
  type ResendConfig,
  type ResendSecrets,
} from '@/server/integrations/resend';
import {
  getSmtpCredentials,
  sendViaSmtp,
  type SmtpConfig,
  type SmtpSecrets,
} from '@/server/integrations/smtp';
import {
  getWhatsAppCredentials,
  testWhatsAppCredentials,
  type WhatsAppConfig,
  type WhatsAppSecrets,
} from '@/server/integrations/whatsapp';

import {
  createAdminRouter,
  staffProcedure,
  supportAdminProcedure,
} from '../admin-trpc';

/**
 * Phase 5.6 — admin.integrations.*
 *
 * Per-provider read/update/test sub-routers. Reads are open to all
 * staff (admin page needs to render); mutations are SUPPORT_ADMIN
 * + audit-logged.
 *
 * The response from `.get` deliberately never returns plaintext
 * secrets — it returns a `hasSecrets` boolean so the UI can show
 * the masked state and offer a "Replace" toggle.
 */

const SENTINEL = '__keep__';

// =====================================================================
// WhatsApp (Meta) — provider='whatsapp_meta'
// =====================================================================

const whatsAppUpdateSchema = z.object({
  appId: z.string().trim().max(120).default(''),
  configId: z.string().trim().max(120).default(''),
  // Empty string means "leave existing"; user must type a fresh
  // value to replace.
  appSecret: z.string().max(2_000).default(''),
  webhookVerifyToken: z.string().max(2_000).default(''),
  enabled: z.boolean(),
});

const whatsAppRouter = createAdminRouter({
  get: staffProcedure.query(async () => {
    const row = await adminLoadIntegration<WhatsAppConfig, WhatsAppSecrets>(
      'whatsapp_meta',
    );
    const live = await getWhatsAppCredentials();
    return {
      provider: 'whatsapp_meta' as const,
      enabled: row?.enabled ?? false,
      config: {
        appId: row?.config.appId ?? '',
        configId: row?.config.configId ?? '',
      },
      hasSecrets: row?.hasSecrets ?? false,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestStatus: row?.lastTestStatus ?? ('UNTESTED' as const),
      lastTestError: row?.lastTestError ?? null,
      // Useful for the admin UI when the DB row is empty + env vars
      // are still driving the live app.
      liveSource: live.source,
      webhookUrlHint: new URL(
        '/api/webhooks/whatsapp',
        appBaseUrl(),
      ).toString(),
    };
  }),

  update: supportAdminProcedure
    .input(whatsAppUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async () => {
        const existing = await adminLoadIntegration<
          WhatsAppConfig,
          WhatsAppSecrets
        >('whatsapp_meta');
        const config = { appId: input.appId, configId: input.configId };

        // Merge secrets: only overwrite fields the user actually typed.
        const incomingAppSecret = input.appSecret.trim();
        const incomingVerifyToken = input.webhookVerifyToken.trim();
        const keepBothExisting =
          incomingAppSecret === '' && incomingVerifyToken === '';
        let secretsPayload: Record<string, unknown> | null = null;
        if (!keepBothExisting) {
          secretsPayload = {
            appSecret:
              incomingAppSecret !== ''
                ? incomingAppSecret
                : (existing?.secrets?.appSecret ?? ''),
            webhookVerifyToken:
              incomingVerifyToken !== ''
                ? incomingVerifyToken
                : (existing?.secrets?.webhookVerifyToken ?? ''),
          };
        }

        await saveIntegration({
          provider: 'whatsapp_meta',
          config,
          secrets: secretsPayload,
          enabled: input.enabled,
          staffUserId: ctx.staff.staffUserId,
        });

        return {
          result: { ok: true as const },
          audit: {
            action: 'admin.integration.whatsapp.updated',
            beforeSnapshot: existing
              ? { enabled: existing.enabled, config: existing.config }
              : null,
            afterSnapshot: { enabled: input.enabled, config },
          },
        };
      });
    }),

  test: supportAdminProcedure.mutation(async () => {
    const creds = await getWhatsAppCredentials();
    if (!creds.appId || !creds.appSecret) {
      const error = 'App ID and App Secret are required to test.';
      await recordTestResult({
        provider: 'whatsapp_meta',
        ok: false,
        error,
      });
      throw new TRPCError({ code: 'BAD_REQUEST', message: error });
    }
    const result = await testWhatsAppCredentials({
      appId: creds.appId,
      appSecret: creds.appSecret,
    });
    await recordTestResult({
      provider: 'whatsapp_meta',
      ok: result.ok,
      error: result.error,
    });
    if (!result.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: result.error ?? 'Test failed.',
      });
    }
    return { ok: true as const };
  }),
});

// =====================================================================
// SMTP — provider='smtp_default'
// =====================================================================

const smtpUpdateSchema = z.object({
  host: z.string().trim().max(255).default(''),
  port: z.number().int().min(1).max(65535).default(587),
  encryption: z.enum(['NONE', 'STARTTLS', 'TLS']).default('STARTTLS'),
  username: z.string().trim().max(255).default(''),
  password: z.string().max(2_000).default(''),
  fromEmail: z.string().trim().email().or(z.literal('')).default(''),
  fromName: z.string().trim().max(120).default(''),
  replyToEmail: z.string().trim().email().or(z.literal('')).default(''),
  enabled: z.boolean(),
});

const smtpRouter = createAdminRouter({
  get: staffProcedure.query(async () => {
    const row = await adminLoadIntegration<SmtpConfig, SmtpSecrets>(
      'smtp_default',
    );
    return {
      provider: 'smtp_default' as const,
      enabled: row?.enabled ?? false,
      config: {
        host: row?.config.host ?? '',
        port: row?.config.port ?? 587,
        encryption: row?.config.encryption ?? 'STARTTLS',
        username: row?.config.username ?? '',
        fromEmail: row?.config.fromEmail ?? '',
        fromName: row?.config.fromName ?? '',
        replyToEmail: row?.config.replyToEmail ?? '',
      },
      hasSecrets: row?.hasSecrets ?? false,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestStatus: row?.lastTestStatus ?? ('UNTESTED' as const),
      lastTestError: row?.lastTestError ?? null,
    };
  }),

  update: supportAdminProcedure
    .input(smtpUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async () => {
        const existing = await adminLoadIntegration<SmtpConfig, SmtpSecrets>(
          'smtp_default',
        );
        const config = {
          host: input.host,
          port: input.port,
          encryption: input.encryption,
          username: input.username,
          fromEmail: input.fromEmail || null,
          fromName: input.fromName,
          replyToEmail: input.replyToEmail || null,
        };
        const incomingPassword = input.password.trim();
        const secretsPayload: Record<string, unknown> | null =
          incomingPassword === ''
            ? null
            : { password: incomingPassword };
        await saveIntegration({
          provider: 'smtp_default',
          config: config as Record<string, unknown>,
          secrets: secretsPayload,
          enabled: input.enabled,
          staffUserId: ctx.staff.staffUserId,
        });
        return {
          result: { ok: true as const },
          audit: {
            action: 'admin.integration.smtp.updated',
            beforeSnapshot: existing
              ? { enabled: existing.enabled, config: existing.config }
              : null,
            afterSnapshot: { enabled: input.enabled, config },
          },
        };
      });
    }),

  sendTest: supportAdminProcedure
    .input(z.object({ to: z.string().trim().email() }))
    .mutation(async ({ input }) => {
      const smtp = await getSmtpCredentials();
      if (!smtp.enabled) {
        const error = 'SMTP integration is disabled.';
        await recordTestResult({ provider: 'smtp_default', ok: false, error });
        throw new TRPCError({ code: 'BAD_REQUEST', message: error });
      }
      const result = await sendViaSmtp({
        to: input.to,
        subject: 'Getyn Campaigns — SMTP test email',
        html: '<p>This is a test message from Getyn Campaigns. If you received this, your SMTP integration is wired correctly.</p>',
        text: 'This is a test message from Getyn Campaigns. If you received this, your SMTP integration is wired correctly.',
      });
      await recordTestResult({
        provider: 'smtp_default',
        ok: result.ok,
        error: result.error,
      });
      if (!result.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error ?? 'Test send failed.',
        });
      }
      return { ok: true as const, messageId: result.messageId };
    }),
});

// =====================================================================
// System email templates — list, get, update, sendTest.
// =====================================================================

const templateUpdateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).default(''),
  subject: z.string().trim().min(1).max(255),
  bodyHtml: z.string().min(1).max(100_000),
  bodyText: z.string().min(1).max(100_000),
  enabled: z.boolean(),
});

const emailTemplateRouter = createAdminRouter({
  list: staffProcedure
    .input(
      z
        .object({
          category: z.nativeEnum(SystemEmailTemplateCategory).optional(),
        })
        .default({}),
    )
    .query(async ({ input }) => {
      const rows = await prisma.systemEmailTemplate.findMany({
        where: input.category ? { category: input.category } : undefined,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      });
      return rows;
    }),

  get: staffProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const row = await prisma.systemEmailTemplate.findUnique({
        where: { id: input.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
      }
      return row;
    }),

  update: supportAdminProcedure
    .input(templateUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async (tx) => {
        const before = await tx.systemEmailTemplate.findUnique({
          where: { id: input.id },
        });
        if (!before) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Template not found.',
          });
        }
        const updated = await tx.systemEmailTemplate.update({
          where: { id: input.id },
          data: {
            name: input.name,
            description: input.description || null,
            subject: input.subject,
            bodyHtml: input.bodyHtml,
            bodyText: input.bodyText,
            enabled: input.enabled,
            lastUpdatedByStaffUserId: ctx.staff.staffUserId,
          },
        });
        return {
          result: updated,
          audit: {
            action: 'admin.email_template.updated',
            targetEntityId: input.id,
            beforeSnapshot: before,
            afterSnapshot: updated,
          },
        };
      });
    }),

  sendTest: supportAdminProcedure
    .input(
      z.object({
        slug: z.string().min(1).max(120),
        to: z.string().trim().email(),
        variables: z.record(z.string(), z.string()).default({}),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await sendSystemEmail({
        to: input.to,
        templateSlug: input.slug,
        variables: input.variables,
      });
      if (!result.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error ?? 'Test send failed.',
        });
      }
      return { ok: true as const, via: result.via, messageId: result.messageId };
    }),
});

// =====================================================================
// Resend (tenant campaign email) — provider='resend'
// =====================================================================

const resendUpdateSchema = z.object({
  apiKey: z.string().max(2_000).default(''),
  defaultFromEmail: z.string().trim().email().or(z.literal('')).default(''),
  webhookSigningSecret: z.string().max(2_000).default(''),
  enabled: z.boolean(),
});

const resendRouter = createAdminRouter({
  get: staffProcedure.query(async () => {
    const row = await adminLoadIntegration<ResendConfig, ResendSecrets>(
      'resend',
    );
    const live = await getResendCredentials();
    return {
      provider: 'resend' as const,
      enabled: row?.enabled ?? false,
      config: {
        defaultFromEmail: row?.config.defaultFromEmail ?? '',
      },
      hasSecrets: row?.hasSecrets ?? false,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestStatus: row?.lastTestStatus ?? ('UNTESTED' as const),
      lastTestError: row?.lastTestError ?? null,
      liveSource: live.source,
      webhookUrlHint: new URL('/api/webhooks/resend', appBaseUrl()).toString(),
    };
  }),

  update: supportAdminProcedure
    .input(resendUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async () => {
        const existing = await adminLoadIntegration<ResendConfig, ResendSecrets>(
          'resend',
        );
        const config = { defaultFromEmail: input.defaultFromEmail };
        const incomingKey = input.apiKey.trim();
        const incomingHook = input.webhookSigningSecret.trim();
        const keepBoth = incomingKey === '' && incomingHook === '';
        const secretsPayload: Record<string, unknown> | null = keepBoth
          ? null
          : {
              apiKey:
                incomingKey !== ''
                  ? incomingKey
                  : (existing?.secrets?.apiKey ?? ''),
              webhookSigningSecret:
                incomingHook !== ''
                  ? incomingHook
                  : (existing?.secrets?.webhookSigningSecret ?? ''),
            };
        await saveIntegration({
          provider: 'resend',
          config: config as Record<string, unknown>,
          secrets: secretsPayload,
          enabled: input.enabled,
          staffUserId: ctx.staff.staffUserId,
        });
        return {
          result: { ok: true as const },
          audit: {
            action: 'admin.integration.resend.updated',
            beforeSnapshot: existing
              ? { enabled: existing.enabled, config: existing.config }
              : null,
            afterSnapshot: { enabled: input.enabled, config },
          },
        };
      });
    }),

  test: supportAdminProcedure.mutation(async () => {
    const creds = await getResendCredentials();
    if (!creds.apiKey) {
      const error = 'API key is required to test.';
      await recordTestResult({ provider: 'resend', ok: false, error });
      throw new TRPCError({ code: 'BAD_REQUEST', message: error });
    }
    const result = await testResendCredentials({ apiKey: creds.apiKey });
    await recordTestResult({
      provider: 'resend',
      ok: result.ok,
      error: result.error,
    });
    if (!result.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: result.error ?? 'Test failed.',
      });
    }
    return { ok: true as const };
  }),
});

// =====================================================================
// Railway Worker API — provider='railway_worker'
// =====================================================================

const railwayUpdateSchema = z.object({
  workerUrl: z.string().trim().url().or(z.literal('')).default(''),
  projectToken: z.string().max(2_000).default(''),
  enabled: z.boolean(),
});

const railwayRouter = createAdminRouter({
  get: staffProcedure.query(async () => {
    const row = await adminLoadIntegration<RailwayConfig, RailwaySecrets>(
      'railway_worker',
    );
    return {
      provider: 'railway_worker' as const,
      enabled: row?.enabled ?? false,
      config: { workerUrl: row?.config.workerUrl ?? '' },
      hasSecrets: row?.hasSecrets ?? false,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestStatus: row?.lastTestStatus ?? ('UNTESTED' as const),
      lastTestError: row?.lastTestError ?? null,
    };
  }),

  update: supportAdminProcedure
    .input(railwayUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      return withAdminContext(ctx.staff, async () => {
        const existing = await adminLoadIntegration<
          RailwayConfig,
          RailwaySecrets
        >('railway_worker');
        const config = { workerUrl: input.workerUrl };
        const incomingToken = input.projectToken.trim();
        const secretsPayload: Record<string, unknown> | null =
          incomingToken === '' ? null : { projectToken: incomingToken };
        await saveIntegration({
          provider: 'railway_worker',
          config: config as Record<string, unknown>,
          secrets: secretsPayload,
          enabled: input.enabled,
          staffUserId: ctx.staff.staffUserId,
        });
        return {
          result: { ok: true as const },
          audit: {
            action: 'admin.integration.railway.updated',
            beforeSnapshot: existing
              ? { enabled: existing.enabled, config: existing.config }
              : null,
            afterSnapshot: { enabled: input.enabled, config },
          },
        };
      });
    }),

  test: supportAdminProcedure.mutation(async () => {
    const railway = await getRailwayWorker();
    if (!railway.workerUrl) {
      const error = 'Worker URL is required to test.';
      await recordTestResult({
        provider: 'railway_worker',
        ok: false,
        error,
      });
      throw new TRPCError({ code: 'BAD_REQUEST', message: error });
    }
    const result = await checkWorkerHealth({ workerUrl: railway.workerUrl });
    await recordTestResult({
      provider: 'railway_worker',
      ok: result.ok,
      error: result.error,
    });
    if (!result.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: result.error ?? 'Health check failed.',
      });
    }
    return { ok: true as const };
  }),
});

// =====================================================================
// Top-level admin.integrations router — fans out per provider.
// =====================================================================

void SENTINEL; // reserved for future "no-op on update" cases

export const adminIntegrationsRouter = createAdminRouter({
  whatsApp: whatsAppRouter,
  smtp: smtpRouter,
  emailTemplate: emailTemplateRouter,
  resend: resendRouter,
  railway: railwayRouter,
});
