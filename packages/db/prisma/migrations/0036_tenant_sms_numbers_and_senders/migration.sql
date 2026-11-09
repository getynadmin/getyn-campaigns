-- Phase 10 — tenant-owned Twilio phone numbers + alphanumeric sender IDs.

CREATE TYPE "TwilioPhoneNumberStatus" AS ENUM ('ACTIVE', 'RELEASED');
CREATE TYPE "AlphaSenderIdStatus" AS ENUM (
  'PENDING_SUBMISSION',
  'SUBMITTED',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "TwilioPhoneNumber" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "friendlyName" TEXT,
  "twilioSid" TEXT NOT NULL,
  "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
  "capabilities" JSONB NOT NULL DEFAULT '{}',
  "status" "TwilioPhoneNumberStatus" NOT NULL DEFAULT 'ACTIVE',
  "checkoutOrderId" TEXT,
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TwilioPhoneNumber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TwilioPhoneNumber_twilioSid_key" ON "TwilioPhoneNumber"("twilioSid");
CREATE INDEX "TwilioPhoneNumber_tenantId_status_idx" ON "TwilioPhoneNumber"("tenantId", "status");
CREATE INDEX "TwilioPhoneNumber_checkoutOrderId_idx" ON "TwilioPhoneNumber"("checkoutOrderId");

ALTER TABLE "TwilioPhoneNumber"
  ADD CONSTRAINT "TwilioPhoneNumber_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TwilioPhoneNumber"
  ADD CONSTRAINT "TwilioPhoneNumber_checkoutOrderId_fkey"
  FOREIGN KEY ("checkoutOrderId") REFERENCES "CheckoutOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE TABLE "AlphanumericSenderId" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "status" "AlphaSenderIdStatus" NOT NULL DEFAULT 'PENDING_SUBMISSION',
  "twilioSid" TEXT,
  "messagingServiceSid" TEXT,
  "rejectionReason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AlphanumericSenderId_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlphanumericSenderId_tenantId_status_idx" ON "AlphanumericSenderId"("tenantId", "status");
CREATE UNIQUE INDEX "AlphanumericSenderId_tenantId_senderId_country_key"
  ON "AlphanumericSenderId"("tenantId", "senderId", "country");

ALTER TABLE "AlphanumericSenderId"
  ADD CONSTRAINT "AlphanumericSenderId_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shared messaging service SID per tenant (created on first alpha sender registration).
ALTER TABLE "Tenant" ADD COLUMN "twilioMessagingServiceSid" TEXT;
