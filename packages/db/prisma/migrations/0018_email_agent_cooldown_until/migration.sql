ALTER TABLE "EmailAgentEnrollment" ADD COLUMN "cooldownUntil" TIMESTAMP(3);
CREATE INDEX "EmailAgentEnrollment_conversationStatus_cooldownUntil_idx"
  ON "EmailAgentEnrollment" ("conversationStatus", "cooldownUntil");
