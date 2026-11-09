-- SMS campaigns + per-recipient sends.

CREATE TYPE "SmsSendStatus" AS ENUM (
  'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERED'
);

CREATE TYPE "SmsProvider" AS ENUM ('TWILIO');

CREATE TABLE "SmsCampaign" (
  "id"            text PRIMARY KEY,
  "campaignId"    text NOT NULL UNIQUE REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "body"          text NOT NULL,
  "fromNumber"    text,
  "provider"      "SmsProvider" NOT NULL DEFAULT 'TWILIO',
  "segmentsPerMessage" integer NOT NULL DEFAULT 1,
  "createdAt"     timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"     timestamp(3) NOT NULL DEFAULT now()
);

CREATE TABLE "SmsCampaignSend" (
  "id"               text PRIMARY KEY,
  "tenantId"         text NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "campaignId"       text NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "contactId"        text NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
  "phone"            text NOT NULL,
  "providerMessageId" text,
  "status"           "SmsSendStatus" NOT NULL DEFAULT 'QUEUED',
  "segments"         integer NOT NULL DEFAULT 1,
  "errorCode"        text,
  "errorMessage"     text,
  "sentAt"           timestamp(3),
  "deliveredAt"      timestamp(3),
  "lastEventAt"      timestamp(3),
  "createdAt"        timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"        timestamp(3) NOT NULL DEFAULT now()
);

CREATE INDEX "SmsCampaignSend_tenantId_campaignId_status_idx"
  ON "SmsCampaignSend"("tenantId", "campaignId", "status");
CREATE INDEX "SmsCampaignSend_tenantId_providerMessageId_idx"
  ON "SmsCampaignSend"("tenantId", "providerMessageId");
CREATE INDEX "SmsCampaignSend_tenantId_status_createdAt_idx"
  ON "SmsCampaignSend"("tenantId", "status", "createdAt");
