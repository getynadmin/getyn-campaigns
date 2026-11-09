-- Phase 10 — in-app notifications surface.
CREATE TYPE "NotificationKind" AS ENUM (
  'CAMPAIGN_SENT',
  'CAMPAIGN_SCHEDULED',
  'CAMPAIGN_FAILED',
  'AGENT_HANDOFF_PENDING',
  'SEGMENT_READY',
  'DOMAIN_VERIFIED',
  'TRIAL_ENDING_SOON',
  'PLAN_UPGRADED',
  'SMS_DELIVERY_ISSUE',
  'WABA_DISCONNECTED',
  'FLOW_ENROLLED_HIGH'
);

CREATE TABLE "Notification" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "userId"    TEXT,
  "kind"      "NotificationKind" NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "href"      TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_tenantId_createdAt_idx"
  ON "Notification"("tenantId", "createdAt" DESC);
CREATE INDEX "Notification_userId_readAt_idx"
  ON "Notification"("userId", "readAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
