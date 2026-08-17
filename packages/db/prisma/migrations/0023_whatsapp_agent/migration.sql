-- WhatsApp Agent — mirror of Email Agent for WhatsApp channel.

CREATE TABLE "WhatsAppAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "persona" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "knowledgeUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phoneNumberId" TEXT NOT NULL,
    "initialTemplateId" TEXT,
    "signature" TEXT,
    "outboundSchedule" JSONB NOT NULL DEFAULT '{"followUpDays": [3, 7, 14], "maxFollowUps": 3}',
    "stopKeywords" TEXT NOT NULL DEFAULT 'stop,unsubscribe,do not message me,remove me',
    "coolingPeriodDays" INTEGER NOT NULL DEFAULT 30,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppAgent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppAgent_tenantId_status_idx" ON "WhatsAppAgent"("tenantId", "status");

ALTER TABLE "WhatsAppAgent"
  ADD CONSTRAINT "WhatsAppAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppAgent_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "WhatsAppPhoneNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppAgent_initialTemplateId_fkey" FOREIGN KEY ("initialTemplateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppAgent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WhatsAppAgentEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whatsappAgentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "conversationStatus" "EmailAgentConversationStatus" NOT NULL DEFAULT 'ACTIVE_CONVERSATION',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "suggestedReplyHint" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppAgentEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAgentEnrollment_whatsappAgentId_contactId_key" ON "WhatsAppAgentEnrollment"("whatsappAgentId", "contactId");
CREATE INDEX "WhatsAppAgentEnrollment_tenantId_conversationStatus_idx" ON "WhatsAppAgentEnrollment"("tenantId", "conversationStatus");
CREATE INDEX "WhatsAppAgentEnrollment_tenantId_nextActionAt_idx" ON "WhatsAppAgentEnrollment"("tenantId", "nextActionAt");
CREATE INDEX "WhatsAppAgentEnrollment_whatsappAgentId_conversationStatus_idx" ON "WhatsAppAgentEnrollment"("whatsappAgentId", "conversationStatus");
CREATE INDEX "WhatsAppAgentEnrollment_status_nextActionAt_idx" ON "WhatsAppAgentEnrollment"("status", "nextActionAt");

ALTER TABLE "WhatsAppAgentEnrollment"
  ADD CONSTRAINT "WhatsAppAgentEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppAgentEnrollment_whatsappAgentId_fkey" FOREIGN KEY ("whatsappAgentId") REFERENCES "WhatsAppAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppAgentEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppAgentMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "direction" "EmailAgentMessageDirection" NOT NULL,
    "status" "EmailAgentMessageStatus" NOT NULL DEFAULT 'SENT',
    "bodyText" TEXT NOT NULL,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "aiGenerationContext" JSONB,
    "aiGenerationCostCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppAgentMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppAgentMessage_enrollmentId_createdAt_idx" ON "WhatsAppAgentMessage"("enrollmentId", "createdAt");
CREATE INDEX "WhatsAppAgentMessage_tenantId_status_idx" ON "WhatsAppAgentMessage"("tenantId", "status");

ALTER TABLE "WhatsAppAgentMessage"
  ADD CONSTRAINT "WhatsAppAgentMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppAgentMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "WhatsAppAgentEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
