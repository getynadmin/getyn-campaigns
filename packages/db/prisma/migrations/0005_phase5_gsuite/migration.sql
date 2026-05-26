-- Phase 5 M1 + M3 + M7 — G-Suite integration schema.
-- Additive only: extends User, Tenant; adds BillingPlan +
-- BillingPlanFeature + BillingSubscription, GSuiteWebhookEvent,
-- StaffUser + StaffAuditLog. No data backfill needed at this point
-- because all new columns are nullable or have defaults.

-- ==================================================================
-- Enums
-- ==================================================================

CREATE TYPE "AuthProvider" AS ENUM ('SUPABASE', 'AUTH0');
CREATE TYPE "ProvisioningSource" AS ENUM ('DIRECT', 'G_SUITE');
CREATE TYPE "BillingPlanMetric" AS ENUM (
  'CONTACTS',
  'EMAILS_PER_MONTH',
  'WA_MESSAGES_PER_MONTH',
  'SMS_SEGMENTS_PER_MONTH',
  'AI_CREDITS_PER_MONTH',
  'CUSTOM_SENDING_DOMAINS',
  'USER_SEATS'
);
CREATE TYPE "BillingSubscriptionStatus" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'SUSPENDED'
);
CREATE TYPE "StaffRole" AS ENUM ('SUPPORT', 'SUPPORT_ADMIN');

-- ==================================================================
-- User — drop NOT NULL on supabaseUserId; add Auth0 fields.
-- Existing rows keep their supabaseUserId; new SSO users insert null.
-- ==================================================================

ALTER TABLE "User"
  ALTER COLUMN "supabaseUserId" DROP NOT NULL,
  ADD COLUMN "auth0UserId" TEXT,
  ADD COLUMN "authProvider" "AuthProvider" NOT NULL DEFAULT 'SUPABASE',
  ADD COLUMN "lastSsoSyncAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_auth0UserId_key" ON "User"("auth0UserId");

-- ==================================================================
-- Tenant — add G-Suite identity mapping + provisioning source.
-- ==================================================================

ALTER TABLE "Tenant"
  ADD COLUMN "gSuiteTenantId" TEXT,
  ADD COLUMN "gSuiteOrgName" TEXT,
  ADD COLUMN "gSuiteSyncedAt" TIMESTAMP(3),
  ADD COLUMN "provisioningSource" "ProvisioningSource" NOT NULL DEFAULT 'DIRECT';

CREATE UNIQUE INDEX "Tenant_gSuiteTenantId_key" ON "Tenant"("gSuiteTenantId");

-- ==================================================================
-- BillingPlan + BillingPlanFeature — plan catalog.
-- Tenant-agnostic; populated by M3's plan sync (and seed).
-- ==================================================================

CREATE TABLE "BillingPlan" (
  "id"                TEXT NOT NULL,
  "slug"              TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "priceMonthlyCents" INTEGER NOT NULL DEFAULT 0,
  "priceYearlyCents"  INTEGER NOT NULL DEFAULT 0,
  "currency"          TEXT NOT NULL DEFAULT 'USD',
  "isArchived"        BOOLEAN NOT NULL DEFAULT false,
  "gSuitePlanId"      TEXT,
  "metadata"          JSONB NOT NULL DEFAULT '{}',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingPlan_slug_key" ON "BillingPlan"("slug");

CREATE TABLE "BillingPlanFeature" (
  "id"                TEXT NOT NULL,
  "planId"            TEXT NOT NULL,
  "metric"            "BillingPlanMetric" NOT NULL,
  "included"          INTEGER NOT NULL DEFAULT 0,
  "overageCentsPer1k" INTEGER,
  CONSTRAINT "BillingPlanFeature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingPlanFeature_planId_metric_key"
  ON "BillingPlanFeature"("planId", "metric");

ALTER TABLE "BillingPlanFeature"
  ADD CONSTRAINT "BillingPlanFeature_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ==================================================================
-- BillingSubscription — Campaigns' local mirror of G-Suite's sub.
-- Always 1:1 with Tenant.
-- ==================================================================

CREATE TABLE "BillingSubscription" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "gSuiteSubscriptionId" TEXT,
  "planId"               TEXT NOT NULL,
  "status"               "BillingSubscriptionStatus" NOT NULL,
  "currentPeriodStart"   TIMESTAMP(3) NOT NULL,
  "currentPeriodEnd"     TIMESTAMP(3) NOT NULL,
  "cancelAt"             TIMESTAMP(3),
  "lastSyncedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata"             JSONB NOT NULL DEFAULT '{}',
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingSubscription_tenantId_key" ON "BillingSubscription"("tenantId");
CREATE UNIQUE INDEX "BillingSubscription_gSuiteSubscriptionId_key" ON "BillingSubscription"("gSuiteSubscriptionId");
CREATE INDEX "BillingSubscription_status_lastSyncedAt_idx" ON "BillingSubscription"("status", "lastSyncedAt");

ALTER TABLE "BillingSubscription"
  ADD CONSTRAINT "BillingSubscription_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingSubscription"
  ADD CONSTRAINT "BillingSubscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==================================================================
-- GSuiteWebhookEvent — audit + idempotency for inbound G-Suite events.
-- ==================================================================

CREATE TABLE "GSuiteWebhookEvent" (
  "id"            TEXT NOT NULL,
  "gSuiteEventId" TEXT NOT NULL,
  "eventType"     TEXT NOT NULL,
  "tenantId"      TEXT,
  "rawPayload"    JSONB NOT NULL,
  "processedAt"   TIMESTAMP(3),
  "processError"  TEXT,
  "receivedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GSuiteWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GSuiteWebhookEvent_gSuiteEventId_key" ON "GSuiteWebhookEvent"("gSuiteEventId");
CREATE INDEX "GSuiteWebhookEvent_eventType_receivedAt_idx" ON "GSuiteWebhookEvent"("eventType", "receivedAt");
CREATE INDEX "GSuiteWebhookEvent_tenantId_idx" ON "GSuiteWebhookEvent"("tenantId");

ALTER TABLE "GSuiteWebhookEvent"
  ADD CONSTRAINT "GSuiteWebhookEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ==================================================================
-- StaffUser + StaffAuditLog (M7 — internal admin surface).
-- ==================================================================

CREATE TABLE "StaffUser" (
  "id"        TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "role"      "StaffRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");
CREATE INDEX "StaffUser_role_idx" ON "StaffUser"("role");

CREATE TABLE "StaffAuditLog" (
  "id"             TEXT NOT NULL,
  "staffUserId"    TEXT NOT NULL,
  "staffEmail"     TEXT NOT NULL,
  "action"         TEXT NOT NULL,
  "targetTenantId" TEXT,
  "targetEntityId" TEXT,
  "beforeSnapshot" JSONB,
  "afterSnapshot"  JSONB,
  "reason"         TEXT,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffAuditLog_staffUserId_createdAt_idx" ON "StaffAuditLog"("staffUserId", "createdAt");
CREATE INDEX "StaffAuditLog_targetTenantId_createdAt_idx" ON "StaffAuditLog"("targetTenantId", "createdAt");
CREATE INDEX "StaffAuditLog_action_createdAt_idx" ON "StaffAuditLog"("action", "createdAt");

ALTER TABLE "StaffAuditLog"
  ADD CONSTRAINT "StaffAuditLog_staffUserId_fkey"
  FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ==================================================================
-- RLS — tenant-agnostic tables (BillingPlan, BillingPlanFeature,
-- StaffUser, StaffAuditLog) lock anon out entirely; service role
-- has full access; authenticated role has SELECT on the plan catalog
-- (so tenant UI can read plan names + features) but NOTHING on staff
-- tables. BillingSubscription + GSuiteWebhookEvent follow the same
-- tenant-scoped pattern as Phase 4 (tenantId match via current_setting).
-- ==================================================================

ALTER TABLE "BillingPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingPlanFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GSuiteWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffAuditLog" ENABLE ROW LEVEL SECURITY;

-- BillingPlan: every authenticated user can read (UI shows plan names)
CREATE POLICY "BillingPlan_select_authenticated" ON "BillingPlan"
  FOR SELECT TO authenticated USING (true);

-- BillingPlanFeature: same — joined to BillingPlan in tRPC reads
CREATE POLICY "BillingPlanFeature_select_authenticated" ON "BillingPlanFeature"
  FOR SELECT TO authenticated USING (true);

-- BillingSubscription: tenant-scoped read
CREATE POLICY "BillingSubscription_select_tenant" ON "BillingSubscription"
  FOR SELECT TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- GSuiteWebhookEvent: tenant-scoped read (null tenantId = unmatched event,
-- service-role-only). Staff admin reads via service role with row-level
-- bypass inside withAdminContext().
CREATE POLICY "GSuiteWebhookEvent_select_tenant" ON "GSuiteWebhookEvent"
  FOR SELECT TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- StaffUser + StaffAuditLog: anon + tenant-auth NEVER read these. The
-- staff admin surface uses the service role; defense in depth so even
-- if a tenant query escapes the tRPC layer it can't reach these.
CREATE POLICY "StaffUser_deny_all" ON "StaffUser" FOR ALL TO authenticated USING (false);
CREATE POLICY "StaffAuditLog_deny_all" ON "StaffAuditLog" FOR ALL TO authenticated USING (false);
