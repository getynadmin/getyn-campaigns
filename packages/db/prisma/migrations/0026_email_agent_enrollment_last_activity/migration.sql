ALTER TABLE "EmailAgentEnrollment" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
UPDATE "EmailAgentEnrollment"
SET "lastActivityAt" = GREATEST(
  "enrolledAt",
  COALESCE("lastSentAt", "enrolledAt"),
  COALESCE("lastInboundAt", "enrolledAt")
);
ALTER TABLE "EmailAgentEnrollment" ALTER COLUMN "lastActivityAt" SET NOT NULL;
ALTER TABLE "EmailAgentEnrollment" ALTER COLUMN "lastActivityAt" SET DEFAULT NOW();
CREATE INDEX "EmailAgentEnrollment_lastActivity_idx"
  ON "EmailAgentEnrollment" ("emailAgentId", "conversationStatus", "lastActivityAt" DESC);
