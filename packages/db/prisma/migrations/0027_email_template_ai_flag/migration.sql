-- EmailTemplate.isAiGenerated — badge for templates produced by the
-- "Generate with AI" flow on /templates.
ALTER TABLE "EmailTemplate" ADD COLUMN "isAiGenerated" BOOLEAN NOT NULL DEFAULT false;
