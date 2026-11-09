-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AutomationKind" AS ENUM ('EMAIL_OUTBOUND', 'WHATSAPP_OUTBOUND', 'WHATSAPP_INBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "Automation"
  ADD COLUMN IF NOT EXISTS "kind" "AutomationKind" NOT NULL DEFAULT 'EMAIL_OUTBOUND';

ALTER TABLE "Automation"
  ADD COLUMN IF NOT EXISTS "inboundTrigger" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Automation_tenantId_kind_status_idx"
  ON "Automation" ("tenantId", "kind", "status");
