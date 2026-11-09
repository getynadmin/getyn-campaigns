-- Dedicated persona field for Email Agent so "Set up with AI" can
-- populate persona and systemInstructions separately (matches the
-- WhatsApp Agent shape).
ALTER TABLE "EmailAgent" ADD COLUMN IF NOT EXISTS "persona" TEXT NOT NULL DEFAULT '';
