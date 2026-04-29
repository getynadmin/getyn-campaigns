-- CreateEnum
CREATE TYPE "WAStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WAQualityRating" AS ENUM ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WAMessagingTier" AS ENUM ('TIER_50', 'TIER_250', 'TIER_1K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED');

-- CreateEnum
CREATE TYPE "WADisplayPhoneStatus" AS ENUM ('CONNECTED', 'PENDING_REVIEW', 'DISCONNECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "WATemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "WATemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "WAPricingCategory" AS ENUM ('AUTHENTICATION', 'MARKETING', 'UTILITY', 'SERVICE');

-- CreateEnum
CREATE TYPE "WASendStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "WAMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WAMessageType" AS ENUM ('TEXT', 'TEMPLATE', 'IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'STICKER', 'LOCATION', 'CONTACT', 'INTERACTIVE_BUTTON', 'INTERACTIVE_LIST', 'REACTION', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "WAConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContactEventType" ADD VALUE 'WHATSAPP_FAILED';
ALTER TYPE "ContactEventType" ADD VALUE 'WHATSAPP_REPLIED';

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "WAStatus" NOT NULL DEFAULT 'PENDING',
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "accessTokenEncrypted" JSONB NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "appId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppPhoneNumber" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whatsAppAccountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "verifiedName" TEXT NOT NULL,
    "qualityRating" "WAQualityRating" NOT NULL DEFAULT 'UNKNOWN',
    "messagingTier" "WAMessagingTier" NOT NULL DEFAULT 'TIER_50',
    "currentTier24hUsage" INTEGER NOT NULL DEFAULT 0,
    "tier24hWindowResetAt" TIMESTAMP(3),
    "displayPhoneNumberStatus" "WADisplayPhoneStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "pinSetAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppPhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whatsAppAccountId" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "WATemplateCategory" NOT NULL,
    "status" "WATemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "components" JSONB NOT NULL,
    "qualityRating" "WAQualityRating" NOT NULL DEFAULT 'UNKNOWN',
    "lastSyncedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCampaign" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "whatsAppAccountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateVariables" JSONB NOT NULL,
    "headerMediaAssetId" TEXT,

    CONSTRAINT "WhatsAppCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCampaignSend" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "metaMessageId" TEXT,
    "status" "WASendStatus" NOT NULL DEFAULT 'QUEUED',
    "pricingCategory" "WAPricingCategory",
    "conversationId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppCampaignSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whatsAppAccountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactPhone" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT NOT NULL DEFAULT '',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "assignedToUserId" TEXT,
    "serviceWindowExpiresAt" TIMESTAMP(3),
    "status" "WAConversationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WAMessageDirection" NOT NULL,
    "metaMessageId" TEXT,
    "type" "WAMessageType" NOT NULL,
    "body" TEXT,
    "mediaAssetId" TEXT,
    "mediaMetaId" TEXT,
    "templateId" TEXT,
    "templateVariables" JSONB,
    "status" "WASendStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "replyToMessageId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "phoneNumberId" TEXT,
    "eventType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mediaMetaId" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGeneration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL,
    "cost" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_tenantId_key" ON "WhatsAppAccount"("tenantId");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_tenantId_idx" ON "WhatsAppAccount"("tenantId");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_wabaId_idx" ON "WhatsAppAccount"("wabaId");

-- CreateIndex
CREATE INDEX "WhatsAppPhoneNumber_whatsAppAccountId_idx" ON "WhatsAppPhoneNumber"("whatsAppAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPhoneNumber_tenantId_phoneNumberId_key" ON "WhatsAppPhoneNumber"("tenantId", "phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_tenantId_status_idx" ON "WhatsAppTemplate"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_whatsAppAccountId_status_idx" ON "WhatsAppTemplate"("whatsAppAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCampaign_campaignId_key" ON "WhatsAppCampaign"("campaignId");

-- CreateIndex
CREATE INDEX "WhatsAppCampaignSend_tenantId_metaMessageId_idx" ON "WhatsAppCampaignSend"("tenantId", "metaMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppCampaignSend_tenantId_campaignId_status_idx" ON "WhatsAppCampaignSend"("tenantId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppCampaignSend_tenantId_status_createdAt_idx" ON "WhatsAppCampaignSend"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_lastMessageAt_idx" ON "WhatsAppConversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_status_lastMessageAt_idx" ON "WhatsAppConversation"("tenantId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_assignedToUserId_lastMessageA_idx" ON "WhatsAppConversation"("tenantId", "assignedToUserId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_tenantId_phoneNumberId_contactPhone_key" ON "WhatsAppConversation"("tenantId", "phoneNumberId", "contactPhone");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_tenantId_metaMessageId_idx" ON "WhatsAppMessage"("tenantId", "metaMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppWebhookEvent_dedupeKey_key" ON "WhatsAppWebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WhatsAppWebhookEvent_tenantId_receivedAt_idx" ON "WhatsAppWebhookEvent"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "WhatsAppWebhookEvent_eventType_processedAt_idx" ON "WhatsAppWebhookEvent"("eventType", "processedAt");

-- CreateIndex
CREATE INDEX "Asset_tenantId_createdAt_idx" ON "Asset"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_tenantId_createdAt_idx" ON "AiGeneration"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiGeneration_tenantId_feature_createdAt_idx" ON "AiGeneration"("tenantId", "feature", "createdAt");

-- AddForeignKey
ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppPhoneNumber" ADD CONSTRAINT "WhatsAppPhoneNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppPhoneNumber" ADD CONSTRAINT "WhatsAppPhoneNumber_whatsAppAccountId_fkey" FOREIGN KEY ("whatsAppAccountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_whatsAppAccountId_fkey" FOREIGN KEY ("whatsAppAccountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_whatsAppAccountId_fkey" FOREIGN KEY ("whatsAppAccountId") REFERENCES "WhatsAppAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "WhatsAppPhoneNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_headerMediaAssetId_fkey" FOREIGN KEY ("headerMediaAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaignSend" ADD CONSTRAINT "WhatsAppCampaignSend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaignSend" ADD CONSTRAINT "WhatsAppCampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaignSend" ADD CONSTRAINT "WhatsAppCampaignSend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_whatsAppAccountId_fkey" FOREIGN KEY ("whatsAppAccountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "WhatsAppPhoneNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "WhatsAppMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppWebhookEvent" ADD CONSTRAINT "WhatsAppWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGeneration" ADD CONSTRAINT "AiGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ==================================================================
-- Phase 4 — partial unique index + RLS policies
-- ==================================================================
--
-- Prisma 5.22 cannot express partial unique indexes in the schema.
-- WhatsAppTemplate uses one so a tenant can recreate a same-name
-- template after soft-deleting an old one.

CREATE UNIQUE INDEX "WhatsAppTemplate_account_name_lang_active_key"
  ON "WhatsAppTemplate" ("whatsAppAccountId", "name", "language")
  WHERE "deletedAt" IS NULL;

-- ------------------------------------------------------------------
-- RLS — Phase 4
--
-- Every Phase 4 table is tenant-scoped. We mirror Phase 1–3's pattern:
-- ENABLE + FORCE row-level security, then add a single policy that
-- gates rows by `app_current_tenant_id()` against `tenantId`.
--
-- WhatsAppCampaign has no own tenantId — it joins through Campaign,
-- mirroring EmailCampaign.
-- ------------------------------------------------------------------

ALTER TABLE "WhatsAppAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppAccount" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waaccount_isolation ON "WhatsAppAccount";
CREATE POLICY waaccount_isolation ON "WhatsAppAccount"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "WhatsAppPhoneNumber" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppPhoneNumber" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waphone_isolation ON "WhatsAppPhoneNumber";
CREATE POLICY waphone_isolation ON "WhatsAppPhoneNumber"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "WhatsAppTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS watemplate_isolation ON "WhatsAppTemplate";
CREATE POLICY watemplate_isolation ON "WhatsAppTemplate"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- WhatsAppCampaign: no tenantId column. Gate via the parent Campaign row.
ALTER TABLE "WhatsAppCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppCampaign" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wacampaign_isolation ON "WhatsAppCampaign";
CREATE POLICY wacampaign_isolation ON "WhatsAppCampaign"
  USING (
    EXISTS (
      SELECT 1 FROM "Campaign" c
      WHERE c."id" = "WhatsAppCampaign"."campaignId"
        AND c."tenantId" = app_current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Campaign" c
      WHERE c."id" = "WhatsAppCampaign"."campaignId"
        AND c."tenantId" = app_current_tenant_id()
    )
  );

ALTER TABLE "WhatsAppCampaignSend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppCampaignSend" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wacampaignsend_isolation ON "WhatsAppCampaignSend";
CREATE POLICY wacampaignsend_isolation ON "WhatsAppCampaignSend"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "WhatsAppConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConversation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waconversation_isolation ON "WhatsAppConversation";
CREATE POLICY waconversation_isolation ON "WhatsAppConversation"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wamessage_isolation ON "WhatsAppMessage";
CREATE POLICY wamessage_isolation ON "WhatsAppMessage"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- WhatsAppWebhookEvent: tenantId can be NULL (we receive an event for
-- a WABA we haven't fully matched yet). The policy lets the receiver
-- write nullable rows AND lets matched rows be read by their tenant.
-- The session-as-service-role path (used by the worker for processing)
-- bypasses RLS entirely; tenants only ever see matched rows.
ALTER TABLE "WhatsAppWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppWebhookEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wawebhookevent_isolation ON "WhatsAppWebhookEvent";
CREATE POLICY wawebhookevent_isolation ON "WhatsAppWebhookEvent"
  USING ("tenantId" IS NULL OR "tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = app_current_tenant_id());

ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Asset" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_isolation ON "Asset";
CREATE POLICY asset_isolation ON "Asset"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "AiGeneration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiGeneration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aigeneration_isolation ON "AiGeneration";
CREATE POLICY aigeneration_isolation ON "AiGeneration"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());
