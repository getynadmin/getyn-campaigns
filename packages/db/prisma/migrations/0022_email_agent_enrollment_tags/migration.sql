ALTER TABLE "EmailAgentEnrollment" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "EmailAgentEnrollment_tags_idx" ON "EmailAgentEnrollment" USING GIN ("tags");
