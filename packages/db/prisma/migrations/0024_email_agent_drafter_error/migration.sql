ALTER TABLE "EmailAgent" ADD COLUMN "lastDrafterErrorAt" TIMESTAMP(3);
ALTER TABLE "EmailAgent" ADD COLUMN "lastDrafterErrorMessage" TEXT;
ALTER TABLE "EmailAgent" ADD COLUMN "drainPausedAt" TIMESTAMP(3);
