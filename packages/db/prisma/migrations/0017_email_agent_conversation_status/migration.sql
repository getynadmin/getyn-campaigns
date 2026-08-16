CREATE TYPE "EmailAgentConversationStatus" AS ENUM ('ACTIVE_CONVERSATION', 'REVIEW_RESPONSE', 'COOLING_PERIOD', 'INACTIVE');

ALTER TABLE "EmailAgentEnrollment"
  ADD COLUMN "conversationStatus" "EmailAgentConversationStatus" NOT NULL DEFAULT 'ACTIVE_CONVERSATION',
  ADD COLUMN "suggestedReplyHint" TEXT;

CREATE INDEX "EmailAgentEnrollment_emailAgentId_conversationStatus_idx"
  ON "EmailAgentEnrollment" ("emailAgentId", "conversationStatus");

ALTER TABLE "EmailAgent"
  ADD COLUMN "stopKeywords" TEXT NOT NULL DEFAULT 'do not email me,unsubscribe,stop emailing,remove me',
  ADD COLUMN "coolingPeriodDays" INTEGER NOT NULL DEFAULT 30;
