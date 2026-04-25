-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('MANUAL', 'IMPORT', 'API', 'FORM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'PENDING');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ImportDedupeStrategy" AS ENUM ('EMAIL', 'PHONE', 'EMAIL_OR_PHONE');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "ContactEventType" AS ENUM ('CREATED', 'UPDATED', 'IMPORTED', 'TAG_ADDED', 'TAG_REMOVED', 'SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'EMAIL_SENT', 'EMAIL_DELIVERED', 'EMAIL_OPENED', 'EMAIL_CLICKED', 'SMS_SENT', 'SMS_DELIVERED', 'WHATSAPP_SENT', 'WHATSAPP_DELIVERED', 'WHATSAPP_READ');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "source" "ContactSource" NOT NULL DEFAULT 'MANUAL',
    "emailStatus" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "smsStatus" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "whatsappStatus" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "cachedCount" INTEGER,
    "cachedCountAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "totalRows" INTEGER,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL,
    "tagIds" TEXT[],
    "defaultEmailStatus" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "defaultSmsStatus" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "defaultWhatsappStatus" "SubscriptionStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "dedupeBy" "ImportDedupeStrategy" NOT NULL DEFAULT 'EMAIL_OR_PHONE',
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "ContactEventType" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_tenantId_createdAt_idx" ON "Contact"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_tenantId_updatedAt_idx" ON "Contact"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_tenantId_emailStatus_idx" ON "Contact"("tenantId", "emailStatus");

-- CreateIndex
CREATE INDEX "Contact_tenantId_smsStatus_idx" ON "Contact"("tenantId", "smsStatus");

-- CreateIndex
CREATE INDEX "Contact_tenantId_whatsappStatus_idx" ON "Contact"("tenantId", "whatsappStatus");

-- CreateIndex
CREATE INDEX "Contact_tenantId_deletedAt_idx" ON "Contact"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tenantId_name_key" ON "Tag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ContactTag_contactId_idx" ON "ContactTag"("contactId");

-- CreateIndex
CREATE INDEX "ContactTag_tagId_idx" ON "ContactTag"("tagId");

-- CreateIndex
CREATE INDEX "CustomField_tenantId_idx" ON "CustomField"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_tenantId_key_key" ON "CustomField"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Segment_tenantId_createdAt_idx" ON "Segment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_createdAt_idx" ON "ImportJob"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_status_idx" ON "ImportJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SuppressionEntry_tenantId_channel_idx" ON "SuppressionEntry"("tenantId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_tenantId_channel_value_key" ON "SuppressionEntry"("tenantId", "channel", "value");

-- CreateIndex
CREATE INDEX "ContactEvent_tenantId_contactId_occurredAt_idx" ON "ContactEvent"("tenantId", "contactId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ContactEvent_tenantId_type_occurredAt_idx" ON "ContactEvent"("tenantId", "type", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ContactEvent_tenantId_occurredAt_idx" ON "ContactEvent"("tenantId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvent" ADD CONSTRAINT "ContactEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvent" ADD CONSTRAINT "ContactEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Partial unique indexes
-- Prisma 5.22 cannot declare partial indexes in schema.prisma. We want
-- (tenantId, email) and (tenantId, phone) to be unique only when the column
-- is non-NULL AND the row is not soft-deleted. That way:
--   • a contact row without an email doesn't collide with another row without
--     an email in the same tenant;
--   • a soft-deleted contact's email/phone can be reused for a new contact.
-- ============================================================================

-- IF NOT EXISTS keeps these statements re-runnable via `pnpm db:rls`
-- (see scripts/apply-rls.ts — it re-applies everything after the
-- "Partial unique indexes" marker).
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_email_unique"
  ON "Contact" ("tenantId", "email")
  WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_phone_unique"
  ON "Contact" ("tenantId", "phone")
  WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL;

-- ============================================================================
-- Row-Level Security — Phase 2 tables
-- Mirrors Phase 1's pattern: FORCE RLS + a single tenant-isolation policy
-- keyed on `app.current_tenant_id` set per transaction by withTenant().
-- DROP POLICY IF EXISTS so the migration is re-runnable.
-- ============================================================================

-- Contact
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_isolation ON "Contact";
CREATE POLICY contact_isolation ON "Contact"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Tag
ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tag" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tag_isolation ON "Tag";
CREATE POLICY tag_isolation ON "Tag"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- ContactTag
-- ContactTag has no tenantId column directly — we gate it through the
-- contact. Since Contact is already RLS-scoped, a query that tries to
-- insert/select a ContactTag for a cross-tenant contactId will fail at
-- the Contact join. But we add an explicit policy via EXISTS so even
-- standalone queries (e.g. "DELETE FROM ContactTag WHERE tagId = ...")
-- can't leak across tenants. The policy checks that the row's contact
-- belongs to the current tenant.
ALTER TABLE "ContactTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactTag" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacttag_isolation ON "ContactTag";
CREATE POLICY contacttag_isolation ON "ContactTag"
  USING (
    EXISTS (
      SELECT 1 FROM "Contact" c
      WHERE c."id" = "ContactTag"."contactId"
        AND c."tenantId" = app_current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Contact" c
      WHERE c."id" = "ContactTag"."contactId"
        AND c."tenantId" = app_current_tenant_id()
    )
  );

-- CustomField
ALTER TABLE "CustomField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomField" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customfield_isolation ON "CustomField";
CREATE POLICY customfield_isolation ON "CustomField"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- Segment
ALTER TABLE "Segment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Segment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS segment_isolation ON "Segment";
CREATE POLICY segment_isolation ON "Segment"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- ImportJob
ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS importjob_isolation ON "ImportJob";
CREATE POLICY importjob_isolation ON "ImportJob"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- SuppressionEntry
ALTER TABLE "SuppressionEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SuppressionEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suppression_isolation ON "SuppressionEntry";
CREATE POLICY suppression_isolation ON "SuppressionEntry"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- ContactEvent
ALTER TABLE "ContactEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contactevent_isolation ON "ContactEvent";
CREATE POLICY contactevent_isolation ON "ContactEvent"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());
