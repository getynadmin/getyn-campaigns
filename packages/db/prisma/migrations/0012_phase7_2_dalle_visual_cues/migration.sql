-- Phase 7.2 — DALL-E image generation + attachment-image reuse.
--
-- 1) AgentAttachment.visualStyleCues — JSONB column populated lazily
--    the first time an image is used as a reference for AI image
--    generation. Cached so subsequent generations don't re-pay the
--    Haiku vision call. Shape:
--      { colors: string[], mood: string, composition: string, subject: string }
--
-- 2) Seed `openai_dalle` IntegrationCredential row so the admin page
--    can configure it without a manual INSERT. Starts disabled so
--    no tenant can hit DALL-E until staff explicitly enables it.

ALTER TABLE "AgentAttachment"
  ADD COLUMN "visualStyleCues" JSONB;

INSERT INTO "IntegrationCredential" (
  "id",
  "provider",
  "displayName",
  "enabled",
  "config",
  "secrets",
  "lastTestStatus",
  "createdAt",
  "updatedAt"
)
VALUES (
  'intcred_openai_dalle',
  'openai_dalle',
  'OpenAI DALL-E 3',
  false,
  '{}'::jsonb,
  NULL,
  'UNTESTED',
  NOW(),
  NOW()
)
ON CONFLICT ("provider") DO NOTHING;
