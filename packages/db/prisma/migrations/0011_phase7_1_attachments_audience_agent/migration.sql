-- Phase 7.1 — Attachments + Audience Agent schema.
--
-- 1) Extends AgentConversation with an agentKind discriminator + makes
--    channel nullable (AUDIENCE rows carry channel = NULL).
-- 2) Adds AgentAttachment (per-conversation file upload metadata) +
--    AgentConversationAttachment join. Attachment storage is wrapped
--    around the existing Asset table — Asset row stays the canonical
--    Storage handle, AgentAttachment carries Phase 7.1-only fields
--    (parsedContent, aiSummary, expiresAt) without polluting Asset.
-- 3) Adds ProposedImportPlan — the Audience Agent's output before
--    user approval. On approval it spawns a Phase 2 ImportJob; the
--    agent never writes to Contact directly.
--
-- Cleanup contract (intentional, documented here so the worker
-- handler can be audited against it): the cleanup cron deletes the
-- Supabase Storage object FIRST, then AgentAttachment, then Asset.
-- The Asset FK is therefore ON DELETE RESTRICT — we never want a
-- cascade to silently orphan a Storage object.

-- =========================================================
-- 1. Enums
-- =========================================================

CREATE TYPE "AgentKind" AS ENUM (
  'CAMPAIGN_EMAIL',
  'CAMPAIGN_WHATSAPP',
  'AUDIENCE'
);

CREATE TYPE "AttachmentType" AS ENUM (
  'IMAGE',
  'PDF',
  'SPREADSHEET',
  'DOCUMENT'
);

CREATE TYPE "ProposedImportPlanStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'REJECTED',
  'IMPORTED',
  'FAILED'
);

-- =========================================================
-- 2. AgentConversation — add agentKind, nullable channel
-- =========================================================

-- Add agentKind with a temporary default so the column can be
-- non-null on existing rows.
ALTER TABLE "AgentConversation"
  ADD COLUMN "agentKind" "AgentKind" NOT NULL DEFAULT 'CAMPAIGN_EMAIL';

-- Backfill from existing channel values. EMAIL → CAMPAIGN_EMAIL,
-- WHATSAPP → CAMPAIGN_WHATSAPP. No AUDIENCE rows exist yet.
UPDATE "AgentConversation"
SET "agentKind" = CASE "channel"
  WHEN 'EMAIL'    THEN 'CAMPAIGN_EMAIL'::"AgentKind"
  WHEN 'WHATSAPP' THEN 'CAMPAIGN_WHATSAPP'::"AgentKind"
END
WHERE "channel" IS NOT NULL;

-- Drop the default so new rows must specify agentKind explicitly.
ALTER TABLE "AgentConversation"
  ALTER COLUMN "agentKind" DROP DEFAULT;

-- Channel becomes nullable (only campaign agents set it).
ALTER TABLE "AgentConversation"
  ALTER COLUMN "channel" DROP NOT NULL;

-- New index for "list conversations of kind X" queries (sidebar
-- counts, audience agent inbox, etc.).
CREATE INDEX "AgentConversation_tenantId_agentKind_lastMessageAt_idx"
  ON "AgentConversation"("tenantId", "agentKind", "lastMessageAt" DESC);

-- =========================================================
-- 3. AgentAttachment
-- =========================================================

CREATE TABLE "AgentAttachment" (
  "id"                    TEXT             NOT NULL,
  "tenantId"              TEXT             NOT NULL,
  "assetId"               TEXT             NOT NULL,
  "attachmentType"        "AttachmentType" NOT NULL,
  "parsedContent"         JSONB,
  "parsedAt"              TIMESTAMP(3),
  "aiSummary"             TEXT,
  "aiSummaryGeneratedAt"  TIMESTAMP(3),
  "aiSummaryModel"        TEXT,
  "expiresAt"             TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "AgentAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentAttachment_tenantId_assetId_key"
  ON "AgentAttachment"("tenantId", "assetId");
CREATE INDEX "AgentAttachment_tenantId_expiresAt_idx"
  ON "AgentAttachment"("tenantId", "expiresAt");
CREATE INDEX "AgentAttachment_tenantId_createdAt_idx"
  ON "AgentAttachment"("tenantId", "createdAt");

ALTER TABLE "AgentAttachment"
  ADD CONSTRAINT "AgentAttachment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentAttachment"
  ADD CONSTRAINT "AgentAttachment_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- =========================================================
-- 4. AgentConversationAttachment (join)
-- =========================================================

CREATE TABLE "AgentConversationAttachment" (
  "id"                    TEXT         NOT NULL,
  "tenantId"              TEXT         NOT NULL,
  "conversationId"        TEXT         NOT NULL,
  "agentAttachmentId"     TEXT         NOT NULL,
  "referencedAtMessageId" TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentConversationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentConversationAttachment_conversationId_agentAttachmentId_key"
  ON "AgentConversationAttachment"("conversationId", "agentAttachmentId");
CREATE INDEX "AgentConversationAttachment_tenantId_conversationId_idx"
  ON "AgentConversationAttachment"("tenantId", "conversationId");

ALTER TABLE "AgentConversationAttachment"
  ADD CONSTRAINT "AgentConversationAttachment_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentConversationAttachment"
  ADD CONSTRAINT "AgentConversationAttachment_agentAttachmentId_fkey"
  FOREIGN KEY ("agentAttachmentId") REFERENCES "AgentAttachment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentConversationAttachment"
  ADD CONSTRAINT "AgentConversationAttachment_referencedAtMessageId_fkey"
  FOREIGN KEY ("referencedAtMessageId") REFERENCES "AgentMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================
-- 5. ProposedImportPlan
-- =========================================================

CREATE TABLE "ProposedImportPlan" (
  "id"                  TEXT                       NOT NULL,
  "tenantId"            TEXT                       NOT NULL,
  "conversationId"      TEXT                       NOT NULL,
  "sourceAssetId"       TEXT                       NOT NULL,
  "columnMapping"       JSONB                      NOT NULL DEFAULT '{}',
  "filters"             JSONB                      NOT NULL DEFAULT '[]',
  "dedupeStrategy"      "ImportDedupeStrategy"     NOT NULL DEFAULT 'EMAIL',
  "tagsToApply"         TEXT[]                     NOT NULL DEFAULT ARRAY[]::TEXT[],
  "defaultEmailStatus"  "ContactChannelStatus"     NOT NULL DEFAULT 'PENDING',
  "estimatedRows"       INTEGER,
  "previewRows"         JSONB                      NOT NULL DEFAULT '[]',
  "validationIssues"    JSONB                      NOT NULL DEFAULT '[]',
  "status"              "ProposedImportPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt"          TIMESTAMP(3),
  "producedImportJobId" TEXT,
  "createdAt"           TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)               NOT NULL,

  CONSTRAINT "ProposedImportPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProposedImportPlan_conversationId_key"
  ON "ProposedImportPlan"("conversationId");
CREATE UNIQUE INDEX "ProposedImportPlan_producedImportJobId_key"
  ON "ProposedImportPlan"("producedImportJobId");
CREATE INDEX "ProposedImportPlan_tenantId_status_idx"
  ON "ProposedImportPlan"("tenantId", "status");

ALTER TABLE "ProposedImportPlan"
  ADD CONSTRAINT "ProposedImportPlan_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProposedImportPlan"
  ADD CONSTRAINT "ProposedImportPlan_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProposedImportPlan"
  ADD CONSTRAINT "ProposedImportPlan_sourceAssetId_fkey"
  FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProposedImportPlan"
  ADD CONSTRAINT "ProposedImportPlan_producedImportJobId_fkey"
  FOREIGN KEY ("producedImportJobId") REFERENCES "ImportJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================
-- 6. RLS — tenant scope on all three new tables.
-- =========================================================

ALTER TABLE "AgentAttachment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AgentAttachment_tenant_scope" ON "AgentAttachment"
  FOR ALL TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "AgentConversationAttachment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AgentConversationAttachment_tenant_scope" ON "AgentConversationAttachment"
  FOR ALL TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "ProposedImportPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ProposedImportPlan_tenant_scope" ON "ProposedImportPlan"
  FOR ALL TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
