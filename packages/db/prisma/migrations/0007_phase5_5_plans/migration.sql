-- Phase 5.5 M0 — local plan catalog + tenant ↔ plan subscriptions.
--
-- This migration:
--   1. Drops the unused Phase 5 M1 BillingPlan / BillingPlanFeature /
--      BillingSubscription tables (zero rows in production — G-Suite
--      integration was paused before these ever populated).
--   2. Renames the legacy `Plan` and `SubscriptionStatus` enums so
--      the unprefixed names can host the new tenant-plan model.
--      Postgres ALTER TYPE handles this without data loss; the
--      `Tenant.plan` column keeps its name (Prisma @map) so we
--      avoid an ALTER COLUMN. `Contact.emailStatus` / `smsStatus` /
--      `whatsappStatus` keep their names too.
--   3. Creates Plan, PlanFeature, Subscription, TenantLimitOverride,
--      PlanUpgradeRequest, AppSettings. RLS policies mirror Phase 5
--      M1's (tenants read their own scope; service role handles
--      writes via the admin tRPC mount).
--   4. Seeds three default plans (Starter / Growth / Pro) with the
--      MVP feature limits.
--   5. Creates the AppSettings singleton row.
--   6. Backfills a Starter subscription for every existing tenant
--      that doesn't have one (zero rows in prod today; included for
--      idempotency and future re-applies).

-- =========================================================
-- 1. Drop unused Phase 5 M1 tables
-- =========================================================

DROP TABLE IF EXISTS "BillingSubscription";
DROP TABLE IF EXISTS "BillingPlanFeature";
DROP TABLE IF EXISTS "BillingPlan";
DROP TYPE IF EXISTS "BillingSubscriptionStatus";
DROP TYPE IF EXISTS "BillingPlanMetric";

-- =========================================================
-- 2. Rename legacy enums (preserves existing data — Postgres
--    ALTER TYPE RENAME is metadata-only).
-- =========================================================

ALTER TYPE "Plan" RENAME TO "LegacyPlanTier";
ALTER TYPE "SubscriptionStatus" RENAME TO "ContactChannelStatus";

-- =========================================================
-- 3. New enums.
-- =========================================================

CREATE TYPE "PlanMetric" AS ENUM (
  'CONTACTS',
  'EMAILS_PER_MONTH',
  'WA_MESSAGES_PER_MONTH',
  'SMS_SEGMENTS_PER_MONTH',
  'AI_CREDITS_PER_MONTH',
  'CUSTOM_SENDING_DOMAINS',
  'USER_SEATS'
);

CREATE TYPE "SubscriptionStatus" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'SUSPENDED'
);

CREATE TYPE "PlanUpgradeRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN'
);

-- =========================================================
-- 4. Plan + PlanFeature
-- =========================================================

CREATE TABLE "Plan" (
  "id"                   TEXT NOT NULL,
  "slug"                 TEXT NOT NULL,
  "name"                 TEXT NOT NULL,
  "description"          TEXT,
  "priceMonthlyCents"    INTEGER,
  "priceYearlyCents"     INTEGER,
  "currency"             TEXT NOT NULL DEFAULT 'USD',
  "isArchived"           BOOLEAN NOT NULL DEFAULT false,
  "isDefault"            BOOLEAN NOT NULL DEFAULT false,
  "metadata"             JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdByStaffUserId" TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");
CREATE INDEX "Plan_isArchived_isDefault_idx" ON "Plan"("isArchived", "isDefault");
-- Enforce "at most one default" without forbidding many non-defaults.
CREATE UNIQUE INDEX "Plan_isDefault_unique" ON "Plan"("isDefault") WHERE "isDefault" = true;

CREATE TABLE "PlanFeature" (
  "id"                 TEXT NOT NULL,
  "planId"             TEXT NOT NULL,
  "metric"             "PlanMetric" NOT NULL,
  "included"           INTEGER NOT NULL DEFAULT 0,
  "overageCentsPer1k"  INTEGER,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanFeature_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlanFeature_planId_metric_key" ON "PlanFeature"("planId", "metric");

-- =========================================================
-- 5. Subscription
-- =========================================================

CREATE TABLE "Subscription" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "planId"                TEXT NOT NULL,
  "status"                "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "assignedByStaffUserId" TEXT,
  "assignedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currentPeriodStart"    TIMESTAMP(3),
  "currentPeriodEnd"      TIMESTAMP(3),
  "cancelAt"              TIMESTAMP(3),
  "metadata"              JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Subscription_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Subscription_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- =========================================================
-- 6. TenantLimitOverride
-- =========================================================

CREATE TABLE "TenantLimitOverride" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "metric"               "PlanMetric" NOT NULL,
  "included"             INTEGER NOT NULL,
  "reason"               TEXT NOT NULL,
  "expiresAt"            TIMESTAMP(3),
  "createdByStaffUserId" TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantLimitOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantLimitOverride_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TenantLimitOverride_tenantId_metric_expiresAt_idx"
  ON "TenantLimitOverride"("tenantId", "metric", "expiresAt");

-- =========================================================
-- 7. PlanUpgradeRequest
-- =========================================================

CREATE TABLE "PlanUpgradeRequest" (
  "id"                    TEXT NOT NULL,
  "tenantId"              TEXT NOT NULL,
  "requestedByUserId"     TEXT NOT NULL,
  "currentPlanId"         TEXT,
  "requestedPlanId"       TEXT NOT NULL,
  "status"                "PlanUpgradeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason"                TEXT,
  "reviewedByStaffUserId" TEXT,
  "reviewedAt"            TIMESTAMP(3),
  "reviewerNote"          TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanUpgradeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanUpgradeRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlanUpgradeRequest_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlanUpgradeRequest_currentPlanId_fkey"
    FOREIGN KEY ("currentPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlanUpgradeRequest_requestedPlanId_fkey"
    FOREIGN KEY ("requestedPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PlanUpgradeRequest_status_createdAt_idx"
  ON "PlanUpgradeRequest"("status", "createdAt" DESC);
CREATE INDEX "PlanUpgradeRequest_tenantId_createdAt_idx"
  ON "PlanUpgradeRequest"("tenantId", "createdAt" DESC);

-- =========================================================
-- 8. AppSettings (singleton enforced by CHECK constraint)
-- =========================================================

CREATE TABLE "AppSettings" (
  "id"                    TEXT NOT NULL DEFAULT 'singleton',
  "defaultPlanId"         TEXT,
  "defaultPlanAutoAssign" BOOLEAN NOT NULL DEFAULT false,
  "allowUpgradeRequests"  BOOLEAN NOT NULL DEFAULT true,
  "updatedByStaffUserId"  TEXT,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppSettings_singleton_check" CHECK ("id" = 'singleton'),
  CONSTRAINT "AppSettings_defaultPlanId_fkey"
    FOREIGN KEY ("defaultPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- =========================================================
-- 9. Row-level security policies
-- =========================================================

ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantLimitOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanUpgradeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSettings" ENABLE ROW LEVEL SECURITY;

-- Plan + PlanFeature: every authenticated user can read (UI shows
-- plan names). Writes go through the admin tRPC mount with the
-- service role.
CREATE POLICY "Plan_select_authenticated" ON "Plan"
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "PlanFeature_select_authenticated" ON "PlanFeature"
  FOR SELECT TO authenticated USING (true);

-- Subscription: tenant-scoped read; resolveTenantLimits + the
-- subscription page join through this row.
CREATE POLICY "Subscription_select_tenant" ON "Subscription"
  FOR SELECT TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- TenantLimitOverride: tenant-scoped read.
CREATE POLICY "TenantLimitOverride_select_tenant" ON "TenantLimitOverride"
  FOR SELECT TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- PlanUpgradeRequest: tenant-scoped read.
CREATE POLICY "PlanUpgradeRequest_select_tenant" ON "PlanUpgradeRequest"
  FOR SELECT TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- AppSettings: service role only — staff admin mutates via
-- withAdminContext(). DENY ALL for authenticated tenants; the
-- subscription UI doesn't need to read the singleton directly
-- (server components inline what they need).
CREATE POLICY "AppSettings_deny_authenticated" ON "AppSettings"
  FOR ALL TO authenticated USING (false);

-- =========================================================
-- 10. Seed default plans (idempotent via slug uniqueness).
-- =========================================================

INSERT INTO "Plan" ("id", "slug", "name", "description", "priceMonthlyCents", "priceYearlyCents", "currency", "isArchived", "isDefault", "metadata", "createdAt", "updatedAt")
VALUES
  ('plan_starter',
   'starter',
   'Starter',
   'For getting off the ground. Solo founders and small teams.',
   1900, 19000, 'USD', false, false, '{}'::jsonb,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_growth',
   'growth',
   'Growth',
   'For scaling teams. More headroom on every channel.',
   4900, 49000, 'USD', false, false, '{}'::jsonb,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_pro',
   'pro',
   'Pro',
   'For high-volume senders. Highest per-channel limits.',
   14900, 149000, 'USD', false, false, '{}'::jsonb,
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- Plan features. Numbers come from the kickoff: Starter 1k/10k/500/100,
-- Growth 5k/50k/2.5k/500, Pro 25k/250k/10k/2k.
INSERT INTO "PlanFeature" ("id", "planId", "metric", "included", "createdAt", "updatedAt") VALUES
  -- Starter
  ('pf_starter_contacts',  'plan_starter', 'CONTACTS',               1000,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_starter_emails',    'plan_starter', 'EMAILS_PER_MONTH',       10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_starter_wa',        'plan_starter', 'WA_MESSAGES_PER_MONTH',  500,   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_starter_ai',        'plan_starter', 'AI_CREDITS_PER_MONTH',   100,   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_starter_sms',       'plan_starter', 'SMS_SEGMENTS_PER_MONTH', 0,     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_starter_domains',   'plan_starter', 'CUSTOM_SENDING_DOMAINS', 1,     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_starter_seats',     'plan_starter', 'USER_SEATS',             3,     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- Growth
  ('pf_growth_contacts',   'plan_growth',  'CONTACTS',               5000,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_emails',     'plan_growth',  'EMAILS_PER_MONTH',       50000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_wa',         'plan_growth',  'WA_MESSAGES_PER_MONTH',  2500,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_ai',         'plan_growth',  'AI_CREDITS_PER_MONTH',   500,   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_sms',        'plan_growth',  'SMS_SEGMENTS_PER_MONTH', 0,     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_domains',    'plan_growth',  'CUSTOM_SENDING_DOMAINS', 3,     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_seats',      'plan_growth',  'USER_SEATS',             10,    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- Pro
  ('pf_pro_contacts',      'plan_pro',     'CONTACTS',               25000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_emails',        'plan_pro',     'EMAILS_PER_MONTH',       250000,CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_wa',            'plan_pro',     'WA_MESSAGES_PER_MONTH',  10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_ai',            'plan_pro',     'AI_CREDITS_PER_MONTH',   2000,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_sms',           'plan_pro',     'SMS_SEGMENTS_PER_MONTH', 0,     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_domains',       'plan_pro',     'CUSTOM_SENDING_DOMAINS', 10,    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_seats',         'plan_pro',     'USER_SEATS',             25,    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("planId", "metric") DO NOTHING;

-- =========================================================
-- 11. AppSettings singleton.
--     defaultPlanId=null + defaultPlanAutoAssign=false by default so
--     admin opts in explicitly via the settings page.
-- =========================================================

INSERT INTO "AppSettings" ("id", "defaultPlanId", "defaultPlanAutoAssign", "allowUpgradeRequests", "updatedAt")
VALUES ('singleton', NULL, false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- =========================================================
-- 12. Backfill existing tenants with the Starter subscription.
--     Idempotent — only inserts where no Subscription row exists.
-- =========================================================

INSERT INTO "Subscription" ("id", "tenantId", "planId", "status", "assignedByStaffUserId", "assignedAt", "currentPeriodStart", "currentPeriodEnd", "metadata", "createdAt", "updatedAt")
SELECT
  'sub_' || replace(gen_random_uuid()::text, '-', ''),
  t."id",
  'plan_starter',
  'ACTIVE',
  NULL,
  CURRENT_TIMESTAMP,
  NULL,
  NULL,
  jsonb_build_object('source', 'phase_5_5_backfill'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
LEFT JOIN "Subscription" s ON s."tenantId" = t."id"
WHERE s."id" IS NULL;
