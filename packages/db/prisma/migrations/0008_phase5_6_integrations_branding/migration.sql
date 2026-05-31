-- Phase 5.6 M0 — platform integrations, system email templates,
-- site branding.
--
-- Three admin-only tables. RLS denies authenticated tenant traffic
-- on all of them; everything flows through withAdminContext() via
-- the service-role Prisma client (same posture as AppSettings in
-- 0007).
--
-- Secrets on IntegrationCredential are stored as a JSON envelope
-- shaped { ciphertext, iv, authTag, keyVersion } from @getyn/crypto,
-- with associated-data "integration:{provider}" so ciphertexts
-- can't be swapped between rows. Env-var fallback is preserved at
-- the application layer so the existing app keeps working until
-- admin fills in the UI.
--
-- Bucket `brand-assets` is created with public read (logos/favicons
-- need CDN-cacheable URLs) and admin-only write (staff JWT claim).

-- =========================================================
-- 1. Enums
-- =========================================================

CREATE TYPE "IntegrationTestStatus" AS ENUM (
  'UNTESTED',
  'OK',
  'FAILED'
);

CREATE TYPE "SystemEmailTemplateCategory" AS ENUM (
  'TRANSACTIONAL',
  'NOTIFICATION',
  'MARKETING'
);

-- =========================================================
-- 2. Tables
-- =========================================================

CREATE TABLE "IntegrationCredential" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "secrets" JSONB,
  "lastUpdatedByStaffUserId" TEXT,
  "lastTestedAt" TIMESTAMP(3),
  "lastTestStatus" "IntegrationTestStatus" NOT NULL DEFAULT 'UNTESTED',
  "lastTestError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationCredential_provider_key"
  ON "IntegrationCredential"("provider");
CREATE INDEX "IntegrationCredential_enabled_idx"
  ON "IntegrationCredential"("enabled");

CREATE TABLE "SystemEmailTemplate" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "subject" TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "variables" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "category" "SystemEmailTemplateCategory" NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastUpdatedByStaffUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemEmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemEmailTemplate_slug_key"
  ON "SystemEmailTemplate"("slug");
CREATE INDEX "SystemEmailTemplate_category_idx"
  ON "SystemEmailTemplate"("category");
CREATE INDEX "SystemEmailTemplate_enabled_idx"
  ON "SystemEmailTemplate"("enabled");

CREATE TABLE "SiteBrandingSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "appName" TEXT NOT NULL DEFAULT 'Getyn Campaigns',
  "defaultSidebarLogoLightUrl" TEXT,
  "defaultSidebarLogoDarkUrl" TEXT,
  "loginPageLogoUrl" TEXT,
  "faviconUrl" TEXT,
  "primaryColor" TEXT,
  "accentColor" TEXT,
  "loginPageTagline" TEXT,
  "footerText" TEXT,
  "customCss" TEXT,
  "updatedByStaffUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteBrandingSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SiteBrandingSettings_singleton_chk"
    CHECK ("id" = 'singleton')
);

-- =========================================================
-- 3. RLS — service-role only on all three (admin-only tables).
-- =========================================================

ALTER TABLE "IntegrationCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemEmailTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteBrandingSettings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "IntegrationCredential_deny_authenticated"
  ON "IntegrationCredential" FOR ALL TO authenticated USING (false);

CREATE POLICY "SystemEmailTemplate_deny_authenticated"
  ON "SystemEmailTemplate" FOR ALL TO authenticated USING (false);

CREATE POLICY "SiteBrandingSettings_deny_authenticated"
  ON "SiteBrandingSettings" FOR ALL TO authenticated USING (false);

-- =========================================================
-- 4. Seed IntegrationCredential rows — one per known provider,
--    enabled=false, secrets=null. Admin fills in via M2–M4 UI.
-- =========================================================

INSERT INTO "IntegrationCredential"
  ("id", "provider", "displayName", "enabled", "config", "secrets",
   "lastTestStatus", "createdAt", "updatedAt")
VALUES
  ('intcred_whatsapp_meta',  'whatsapp_meta',  'WhatsApp Business (Meta)',
   false, '{}'::jsonb, NULL, 'UNTESTED', NOW(), NOW()),
  ('intcred_smtp_default',   'smtp_default',   'System SMTP',
   false, '{}'::jsonb, NULL, 'UNTESTED', NOW(), NOW()),
  ('intcred_resend',         'resend',         'Resend (tenant campaigns)',
   false, '{}'::jsonb, NULL, 'UNTESTED', NOW(), NOW()),
  ('intcred_railway_worker', 'railway_worker', 'Railway Worker API',
   false, '{}'::jsonb, NULL, 'UNTESTED', NOW(), NOW()),
  ('intcred_twilio',         'twilio',         'Twilio SMS',
   false, '{}'::jsonb, NULL, 'UNTESTED', NOW(), NOW()),
  ('intcred_msg91',          'msg91',          'MSG91 SMS',
   false, '{}'::jsonb, NULL, 'UNTESTED', NOW(), NOW())
ON CONFLICT ("provider") DO NOTHING;

-- =========================================================
-- 5. Seed SystemEmailTemplate rows — 10 transactional/notification
--    templates with sensible starter copy. Admins edit in M3b.
--    Bodies kept intentionally short and clean; the editor lets
--    teams brand them properly.
-- =========================================================

INSERT INTO "SystemEmailTemplate"
  ("id", "slug", "name", "description", "subject", "bodyHtml", "bodyText",
   "variables", "category", "isSystem", "enabled", "createdAt", "updatedAt")
VALUES
  ('emt_welcome_signup', 'welcome_signup',
   'Welcome to {{appName}}',
   'Sent when a new user signs up for a workspace.',
   'Welcome to {{appName}}',
   '<p>Hi {{firstName}},</p><p>Welcome to {{appName}} — your workspace <strong>{{tenantName}}</strong> is ready.</p><p><a href="{{dashboardUrl}}">Open your dashboard</a></p><p>Need help? Reply to this email.</p>',
   'Hi {{firstName}},

Welcome to {{appName}} — your workspace {{tenantName}} is ready.

Open your dashboard: {{dashboardUrl}}

Need help? Reply to this email.',
   '["firstName","appName","tenantName","dashboardUrl"]'::jsonb,
   'TRANSACTIONAL', true, true, NOW(), NOW()),

  ('emt_email_verification', 'email_verification',
   'Verify your email',
   'One-time link to verify a newly-signed-up email address.',
   'Verify your email for {{appName}}',
   '<p>Hi {{firstName}},</p><p>Confirm your email so we can finish setting up your {{appName}} account.</p><p><a href="{{verifyUrl}}">Verify email</a></p><p>This link expires in 24 hours.</p>',
   'Hi {{firstName}},

Confirm your email so we can finish setting up your {{appName}} account.

Verify: {{verifyUrl}}

This link expires in 24 hours.',
   '["firstName","appName","verifyUrl"]'::jsonb,
   'TRANSACTIONAL', true, true, NOW(), NOW()),

  ('emt_password_reset', 'password_reset',
   'Reset your password',
   'Password reset link triggered from /forgot.',
   'Reset your password',
   '<p>Hi {{firstName}},</p><p>Someone (hopefully you) asked to reset the password for {{email}}.</p><p><a href="{{resetUrl}}">Reset password</a></p><p>This link expires in 1 hour. If you didn''t request this, ignore the email.</p>',
   'Hi {{firstName}},

Someone (hopefully you) asked to reset the password for {{email}}.

Reset: {{resetUrl}}

This link expires in 1 hour. If you didn''t request this, ignore the email.',
   '["firstName","email","resetUrl"]'::jsonb,
   'TRANSACTIONAL', true, true, NOW(), NOW()),

  ('emt_team_invite', 'team_invite',
   '{{inviterName}} invited you to join {{tenantName}}',
   'Workspace invitation email.',
   '{{inviterName}} invited you to join {{tenantName}}',
   '<p>Hi,</p><p><strong>{{inviterName}}</strong> invited you to join <strong>{{tenantName}}</strong> on {{appName}} as a {{role}}.</p><p><a href="{{acceptUrl}}">Accept invitation</a></p><p>This invitation expires on {{expiresAt}}.</p>',
   'Hi,

{{inviterName}} invited you to join {{tenantName}} on {{appName}} as a {{role}}.

Accept: {{acceptUrl}}

This invitation expires on {{expiresAt}}.',
   '["inviterName","tenantName","appName","role","acceptUrl","expiresAt"]'::jsonb,
   'TRANSACTIONAL', true, true, NOW(), NOW()),

  ('emt_account_activated', 'account_activated',
   'Your account is now active',
   'Sent after staff lifts a suspension or activates a tenant.',
   'Your {{appName}} account is active',
   '<p>Hi {{firstName}},</p><p>Your {{appName}} workspace <strong>{{tenantName}}</strong> is now active. Sending is enabled again.</p><p><a href="{{dashboardUrl}}">Open dashboard</a></p>',
   'Hi {{firstName}},

Your {{appName}} workspace {{tenantName}} is now active. Sending is enabled again.

Open dashboard: {{dashboardUrl}}',
   '["firstName","appName","tenantName","dashboardUrl"]'::jsonb,
   'NOTIFICATION', true, true, NOW(), NOW()),

  ('emt_account_suspended', 'account_suspended',
   'Your account has been suspended',
   'Sent when a workspace is auto-suspended or staff-suspended.',
   'Your {{appName}} account has been suspended',
   '<p>Hi {{firstName}},</p><p>Your {{appName}} workspace <strong>{{tenantName}}</strong> has been suspended.</p><p><strong>Reason:</strong> {{reason}}</p><p>Reply to this email to discuss reactivation.</p>',
   'Hi {{firstName}},

Your {{appName}} workspace {{tenantName}} has been suspended.

Reason: {{reason}}

Reply to this email to discuss reactivation.',
   '["firstName","appName","tenantName","reason"]'::jsonb,
   'NOTIFICATION', true, true, NOW(), NOW()),

  ('emt_plan_upgrade_requested', 'plan_upgrade_requested',
   'Upgrade request submitted',
   'Sent to the tenant + staff admins when a plan upgrade request is filed.',
   'Upgrade request received',
   '<p>Hi {{firstName}},</p><p>We received your request to move <strong>{{tenantName}}</strong> from {{currentPlanName}} to <strong>{{requestedPlanName}}</strong>.</p><p>Our team will follow up shortly.</p>',
   'Hi {{firstName}},

We received your request to move {{tenantName}} from {{currentPlanName}} to {{requestedPlanName}}.

Our team will follow up shortly.',
   '["firstName","tenantName","currentPlanName","requestedPlanName"]'::jsonb,
   'NOTIFICATION', true, true, NOW(), NOW()),

  ('emt_plan_upgrade_approved', 'plan_upgrade_approved',
   'Your upgrade to {{planName}} is now active',
   'Sent when staff approves a plan upgrade request.',
   'You''re now on {{planName}}',
   '<p>Hi {{firstName}},</p><p>Your upgrade to <strong>{{planName}}</strong> is now active on <strong>{{tenantName}}</strong>. The new limits take effect immediately.</p><p><a href="{{subscriptionUrl}}">View your subscription</a></p>',
   'Hi {{firstName}},

Your upgrade to {{planName}} is now active on {{tenantName}}. The new limits take effect immediately.

View your subscription: {{subscriptionUrl}}',
   '["firstName","planName","tenantName","subscriptionUrl"]'::jsonb,
   'TRANSACTIONAL', true, true, NOW(), NOW()),

  ('emt_plan_upgrade_rejected', 'plan_upgrade_rejected',
   'About your upgrade request',
   'Sent when staff rejects a plan upgrade request.',
   'About your upgrade request',
   '<p>Hi {{firstName}},</p><p>We weren''t able to approve the upgrade request for <strong>{{tenantName}}</strong> right now.</p><p><strong>Note from our team:</strong></p><p>{{reviewerNote}}</p><p>Reply to this email if you''d like to discuss.</p>',
   'Hi {{firstName}},

We weren''t able to approve the upgrade request for {{tenantName}} right now.

Note from our team:
{{reviewerNote}}

Reply to this email if you''d like to discuss.',
   '["firstName","tenantName","reviewerNote"]'::jsonb,
   'NOTIFICATION', true, true, NOW(), NOW()),

  ('emt_impersonation_notice', 'impersonation_notice',
   'A support team member accessed your workspace',
   'Notification sent to workspace owner when staff starts an impersonation session.',
   'Support access notification',
   '<p>Hi {{firstName}},</p><p>A support team member ({{staffEmail}}) accessed <strong>{{tenantName}}</strong> at {{startedAt}}.</p><p><strong>Reason:</strong> {{reason}}</p><p>If you didn''t request this, reply immediately so we can investigate.</p>',
   'Hi {{firstName}},

A support team member ({{staffEmail}}) accessed {{tenantName}} at {{startedAt}}.

Reason: {{reason}}

If you didn''t request this, reply immediately so we can investigate.',
   '["firstName","staffEmail","tenantName","startedAt","reason"]'::jsonb,
   'NOTIFICATION', true, true, NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

-- =========================================================
-- 6. Seed SiteBrandingSettings singleton.
-- =========================================================

INSERT INTO "SiteBrandingSettings" ("id", "appName", "updatedAt")
VALUES ('singleton', 'Getyn Campaigns', NOW())
ON CONFLICT ("id") DO NOTHING;

-- =========================================================
-- 7. Supabase Storage bucket — brand-assets.
--    Public read so logos/favicons can be CDN-cached cheaply;
--    writes restricted to service role (admin tRPC mutations
--    upload via the service-role client).
--
--    The storage.objects insert ON CONFLICT handles re-runs.
-- =========================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone (anon/authenticated) to read brand-assets objects.
DROP POLICY IF EXISTS "brand-assets read" ON storage.objects;
CREATE POLICY "brand-assets read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

-- Writes/updates/deletes only via service role (admin tRPC
-- path). No policy is needed for service role — it bypasses RLS
-- by default. We deny writes from authenticated clients
-- explicitly so the bucket can't be tampered with from the
-- tenant app.
DROP POLICY IF EXISTS "brand-assets deny writes to authenticated" ON storage.objects;
CREATE POLICY "brand-assets deny writes to authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'brand-assets');

DROP POLICY IF EXISTS "brand-assets deny updates to authenticated" ON storage.objects;
CREATE POLICY "brand-assets deny updates to authenticated"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id <> 'brand-assets');

DROP POLICY IF EXISTS "brand-assets deny deletes to authenticated" ON storage.objects;
CREATE POLICY "brand-assets deny deletes to authenticated"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id <> 'brand-assets');
