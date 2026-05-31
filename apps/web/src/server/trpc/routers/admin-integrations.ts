import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withAdminContext } from '@/server/admin/with-admin-context';
import {
  adminLoadIntegration,
  recordTestResult,
  saveIntegration,
} from '@/server/integrations/credential-store';
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
        process.env.APP_BASE_URL ?? 'https://example.com',
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
// Top-level admin.integrations router — fans out per provider.
// =====================================================================

void SENTINEL; // reserved for future "no-op on update" cases

export const adminIntegrationsRouter = createAdminRouter({
  whatsApp: whatsAppRouter,
});
