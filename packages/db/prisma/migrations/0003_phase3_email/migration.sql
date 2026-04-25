-- CreateEnum
CREATE TYPE "SendingDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "EmailTemplateCategory" AS ENUM ('NEWSLETTER', 'ANNOUNCEMENT', 'PROMOTIONAL', 'TRANSACTIONAL', 'EVENT', 'WELCOME', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignSendStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "AbVariant" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "CampaignEventType" AS ENUM ('SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'FAILED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "companyDisplayName" TEXT,
ADD COLUMN     "defaultFromName" TEXT,
ADD COLUMN     "postalAddress" TEXT;

-- CreateTable
CREATE TABLE "SendingDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "resendDomainId" TEXT,
    "status" "SendingDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "dnsRecords" JSONB NOT NULL DEFAULT '[]',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'EMAIL',
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "segmentId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "previewText" TEXT,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "sendingDomainId" TEXT,
    "designJson" JSONB NOT NULL,
    "renderedHtml" TEXT,
    "renderedText" TEXT,
    "abTest" JSONB,
    "templateId" TEXT,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "EmailTemplateCategory" NOT NULL DEFAULT 'OTHER',
    "thumbnailUrl" TEXT,
    "designJson" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSend" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "messageId" TEXT,
    "status" "CampaignSendStatus" NOT NULL DEFAULT 'QUEUED',
    "abVariant" "AbVariant",
    "sentAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignSendId" TEXT NOT NULL,
    "campaignId" TEXT,
    "type" "CampaignEventType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSendingPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dailySendLimit" INTEGER NOT NULL DEFAULT 200,
    "complaintRateThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.003,
    "bounceRateThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "currentDailyCount" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cachedComplaintRate30d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cachedBounceRate30d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cachedSendCount30d" INTEGER NOT NULL DEFAULT 0,
    "cachedRatesUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSendingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SendingDomain_tenantId_status_idx" ON "SendingDomain"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SendingDomain_tenantId_domain_key" ON "SendingDomain"("tenantId", "domain");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_scheduledAt_idx" ON "Campaign"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_createdAt_idx" ON "Campaign"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCampaign_campaignId_key" ON "EmailCampaign"("campaignId");

-- CreateIndex
CREATE INDEX "EmailTemplate_tenantId_category_idx" ON "EmailTemplate"("tenantId", "category");

-- CreateIndex
CREATE INDEX "EmailTemplate_tenantId_createdAt_idx" ON "EmailTemplate"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSend_messageId_key" ON "CampaignSend"("messageId");

-- CreateIndex
CREATE INDEX "CampaignSend_tenantId_campaignId_status_idx" ON "CampaignSend"("tenantId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignSend_tenantId_contactId_idx" ON "CampaignSend"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "CampaignEvent_tenantId_campaignSendId_occurredAt_idx" ON "CampaignEvent"("tenantId", "campaignSendId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "CampaignEvent_tenantId_type_occurredAt_idx" ON "CampaignEvent"("tenantId", "type", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "CampaignEvent_tenantId_campaignId_occurredAt_idx" ON "CampaignEvent"("tenantId", "campaignId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_slug_key" ON "TrackingLink"("slug");

-- CreateIndex
CREATE INDEX "TrackingLink_tenantId_campaignId_idx" ON "TrackingLink"("tenantId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSendingPolicy_tenantId_key" ON "TenantSendingPolicy"("tenantId");

-- AddForeignKey
ALTER TABLE "SendingDomain" ADD CONSTRAINT "SendingDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_sendingDomainId_fkey" FOREIGN KEY ("sendingDomainId") REFERENCES "SendingDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignSendId_fkey" FOREIGN KEY ("campaignSendId") REFERENCES "CampaignSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSendingPolicy" ADD CONSTRAINT "TenantSendingPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Partial unique indexes
-- (Marker recognized by scripts/apply-rls.ts. Everything below this line is
-- idempotent — DROP IF EXISTS / CREATE IF NOT EXISTS — so the script can
-- re-apply after `prisma db push` without conflicts.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RLS — every Phase 3 tenant-scoped table mirrors the Phase 2 pattern.
-- All read + write paths from the app go through `withTenant(tenantId, fn)`,
-- which sets `app.current_tenant_id` for the transaction. The `FORCE ROW
-- LEVEL SECURITY` flag means even table owners are subject to the policy —
-- this catches missing `withTenant()` wrappers during development instead
-- of silently leaking cross-tenant data.
-- ----------------------------------------------------------------------------

-- SendingDomain
ALTER TABLE "SendingDomain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SendingDomain" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sendingdomain_isolation ON "SendingDomain";
CREATE POLICY sendingdomain_isolation ON "SendingDomain"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Campaign
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_isolation ON "Campaign";
CREATE POLICY campaign_isolation ON "Campaign"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- EmailCampaign — joins through Campaign (no own tenantId; same shape as
-- ContactTag policy from Phase 2). EXISTS-form so the planner can short-
-- circuit when the parent Campaign is already filtered.
ALTER TABLE "EmailCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailCampaign" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emailcampaign_isolation ON "EmailCampaign";
CREATE POLICY emailcampaign_isolation ON "EmailCampaign"
  USING (
    EXISTS (
      SELECT 1 FROM "Campaign" c
      WHERE c."id" = "EmailCampaign"."campaignId"
        AND c."tenantId" = app_current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Campaign" c
      WHERE c."id" = "EmailCampaign"."campaignId"
        AND c."tenantId" = app_current_tenant_id()
    )
  );

-- EmailTemplate — TWO policies:
--   1. System templates (tenantId IS NULL) are READ-ONLY to every authenticated user
--   2. Tenant-owned templates follow the standard tenant-isolation shape
ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emailtemplate_system_read ON "EmailTemplate";
CREATE POLICY emailtemplate_system_read ON "EmailTemplate"
  FOR SELECT
  USING ("tenantId" IS NULL);

DROP POLICY IF EXISTS emailtemplate_tenant_isolation ON "EmailTemplate";
CREATE POLICY emailtemplate_tenant_isolation ON "EmailTemplate"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- CampaignSend
ALTER TABLE "CampaignSend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignSend" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaignsend_isolation ON "CampaignSend";
CREATE POLICY campaignsend_isolation ON "CampaignSend"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- CampaignEvent
ALTER TABLE "CampaignEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaignevent_isolation ON "CampaignEvent";
CREATE POLICY campaignevent_isolation ON "CampaignEvent"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- TrackingLink
ALTER TABLE "TrackingLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrackingLink" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trackinglink_isolation ON "TrackingLink";
CREATE POLICY trackinglink_isolation ON "TrackingLink"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- TenantSendingPolicy
ALTER TABLE "TenantSendingPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantSendingPolicy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenantsendingpolicy_isolation ON "TenantSendingPolicy";
CREATE POLICY tenantsendingpolicy_isolation ON "TenantSendingPolicy"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- ----------------------------------------------------------------------------
-- Backfill TenantSendingPolicy for every existing tenant.
-- One row per tenant with plan-appropriate dailySendLimit:
--   TRIAL    -> 50
--   STARTER  -> 200
--   GROWTH   -> 5000
--   PRO      -> 50000
-- Idempotent via the unique constraint on tenantId.
-- ----------------------------------------------------------------------------

INSERT INTO "TenantSendingPolicy" ("id", "tenantId", "dailySendLimit", "updatedAt")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  t."id",
  CASE t."plan"
    WHEN 'TRIAL'   THEN 50
    WHEN 'STARTER' THEN 200
    WHEN 'GROWTH'  THEN 5000
    WHEN 'PRO'     THEN 50000
    ELSE 200
  END,
  NOW()
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "TenantSendingPolicy" p WHERE p."tenantId" = t."id"
);

-- ----------------------------------------------------------------------------
-- EmailCampaign.renderedHtml immutability — once a Campaign has moved out
-- of DRAFT, the rendered HTML is locked. Mid-flight edits would mean
-- recipients in the same campaign got different content. The tRPC layer
-- (`campaign.update`) enforces this too; the trigger is defense in depth.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_email_campaign_rendered_html_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  -- Only check on UPDATE where renderedHtml actually changes.
  IF OLD."renderedHtml" IS NOT DISTINCT FROM NEW."renderedHtml" THEN
    RETURN NEW;
  END IF;

  SELECT c."status"::text INTO parent_status
  FROM "Campaign" c
  WHERE c."id" = NEW."campaignId";

  -- DRAFT is the only writable state. SENDING/SENT/etc. → reject.
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION
      'EmailCampaign.renderedHtml is immutable once Campaign status moves out of DRAFT (campaign id=%, status=%)',
      NEW."campaignId", parent_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_campaign_rendered_html_immutable
  ON "EmailCampaign";
CREATE TRIGGER email_campaign_rendered_html_immutable
  BEFORE UPDATE ON "EmailCampaign"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_email_campaign_rendered_html_immutable();
