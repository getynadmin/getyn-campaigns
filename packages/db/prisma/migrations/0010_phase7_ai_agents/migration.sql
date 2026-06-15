-- Phase 7 M0 — AI Campaign Agents schema.
--
-- Adds tenant brand profile + conversation/message persistence +
-- a global email block library. Extends PlanMetric with a new
-- conversation cap and updates the three seeded plans accordingly.
--
-- The 12 block templates seeded here are STRUCTURAL — valid Unlayer
-- schema shape with {{placeholder}} tokens, but the JSON skeletons
-- may need styling tuning in M3 when the composer + live preview
-- land. M3's critical-review item is "Unlayer JSON validates and
-- renders for every block"; this migration creates the rows so
-- the table is available, the M3 work hardens the JSON.

-- =========================================================
-- 1. Enums
-- =========================================================

CREATE TYPE "VoiceTone" AS ENUM (
  'PROFESSIONAL',
  'FRIENDLY',
  'CASUAL',
  'PLAYFUL',
  'AUTHORITATIVE',
  'EMPATHETIC'
);

CREATE TYPE "AgentChannel" AS ENUM (
  'EMAIL',
  'WHATSAPP'
);

CREATE TYPE "AgentConversationStatus" AS ENUM (
  'ACTIVE',
  'COMPLETED_DRAFT_CREATED',
  'ABANDONED',
  'FAILED'
);

CREATE TYPE "AgentMessageRole" AS ENUM (
  'USER',
  'ASSISTANT',
  'TOOL_CALL',
  'TOOL_RESULT',
  'SYSTEM'
);

CREATE TYPE "EmailBlockCategory" AS ENUM (
  'HERO',
  'CONTENT',
  'MEDIA',
  'CTA',
  'FOOTER',
  'DIVIDER',
  'SOCIAL'
);

-- Extend PlanMetric with the agent conversation cap.
ALTER TYPE "PlanMetric" ADD VALUE IF NOT EXISTS 'AI_AGENT_CONVERSATIONS_PER_MONTH';

-- =========================================================
-- 2. Tables
-- =========================================================

CREATE TABLE "TenantBrandProfile" (
  "id"                      TEXT NOT NULL,
  "tenantId"                TEXT NOT NULL,
  "brandName"               TEXT NOT NULL,
  "brandTagline"            TEXT,
  "brandDescription"        TEXT NOT NULL,
  "primaryColor"            TEXT NOT NULL,
  "secondaryColor"          TEXT,
  "accentColor"             TEXT,
  "logoAssetId"             TEXT,
  "logoUrl"                 TEXT,
  "voiceTone"               "VoiceTone" NOT NULL DEFAULT 'FRIENDLY',
  "writingStyle"            TEXT,
  "industry"                TEXT,
  "targetAudience"          TEXT,
  "dosAndDonts"             TEXT,
  "signatureBlock"          TEXT,
  "socialLinks"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "unsubscribeFooterCustom" TEXT,
  "completedAt"             TIMESTAMP(3),
  "updatedByUserId"         TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantBrandProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantBrandProfile_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "TenantBrandProfile_logoAssetId_fkey"
    FOREIGN KEY ("logoAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "TenantBrandProfile_tenantId_key"
  ON "TenantBrandProfile"("tenantId");

CREATE TABLE "AgentConversation" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "createdByUserId"    TEXT NOT NULL,
  "channel"            "AgentChannel" NOT NULL,
  "status"             "AgentConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "goal"               TEXT,
  "producedCampaignId" TEXT,
  "conversationState"  JSONB NOT NULL DEFAULT '{}'::jsonb,
  "tokensUsed"         INTEGER NOT NULL DEFAULT 0,
  "costCents"          INTEGER NOT NULL DEFAULT 0,
  "title"              TEXT,
  "lastMessageAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentConversation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "AgentConversation_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "AgentConversation_producedCampaignId_fkey"
    FOREIGN KEY ("producedCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "AgentConversation_producedCampaignId_key"
  ON "AgentConversation"("producedCampaignId");
CREATE INDEX "AgentConversation_tenantId_status_lastMessageAt_idx"
  ON "AgentConversation"("tenantId", "status", "lastMessageAt" DESC);
CREATE INDEX "AgentConversation_createdByUserId_lastMessageAt_idx"
  ON "AgentConversation"("createdByUserId", "lastMessageAt" DESC);

CREATE TABLE "AgentMessage" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "role"           "AgentMessageRole" NOT NULL,
  "content"        TEXT,
  "toolName"       TEXT,
  "toolInput"      JSONB,
  "toolOutput"     JSONB,
  "tokensInput"    INTEGER,
  "tokensOutput"   INTEGER,
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE
);

CREATE INDEX "AgentMessage_conversationId_createdAt_idx"
  ON "AgentMessage"("conversationId", "createdAt");

CREATE TABLE "EmailBlockTemplate" (
  "id"                        TEXT NOT NULL,
  "slug"                      TEXT NOT NULL,
  "name"                      TEXT NOT NULL,
  "description"               TEXT NOT NULL,
  "category"                  "EmailBlockCategory" NOT NULL,
  "previewImageUrl"           TEXT,
  "unlayerDesignJsonTemplate" JSONB NOT NULL,
  "placeholders"              JSONB NOT NULL DEFAULT '[]'::jsonb,
  "compatibleAfter"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailBlockTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailBlockTemplate_slug_key" ON "EmailBlockTemplate"("slug");
CREATE INDEX "EmailBlockTemplate_category_idx" ON "EmailBlockTemplate"("category");

-- =========================================================
-- 3. Row-level security
-- =========================================================

ALTER TABLE "TenantBrandProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailBlockTemplate" ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped: match on app.current_tenant_id (same pattern as
-- Contact / Campaign).
CREATE POLICY "TenantBrandProfile_tenant_scope" ON "TenantBrandProfile"
  FOR ALL TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY "AgentConversation_tenant_scope" ON "AgentConversation"
  FOR ALL TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY "AgentMessage_tenant_scope" ON "AgentMessage"
  FOR ALL TO authenticated
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- EmailBlockTemplate: global read, writes service-role only (the
-- block library is curated centrally; tenants don't author blocks).
CREATE POLICY "EmailBlockTemplate_read" ON "EmailBlockTemplate"
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "EmailBlockTemplate_deny_writes" ON "EmailBlockTemplate"
  FOR ALL TO authenticated USING (false);

-- =========================================================
-- 4. Plan-feature seed updates — new metric on existing plans.
--    Limits per Phase 7 spec.
-- =========================================================

INSERT INTO "PlanFeature" ("id", "planId", "metric", "included", "createdAt", "updatedAt") VALUES
  ('pf_starter_agent', 'plan_starter', 'AI_AGENT_CONVERSATIONS_PER_MONTH', 10,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_growth_agent',  'plan_growth',  'AI_AGENT_CONVERSATIONS_PER_MONTH', 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pf_pro_agent',     'plan_pro',     'AI_AGENT_CONVERSATIONS_PER_MONTH', 500, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("planId", "metric") DO NOTHING;

-- =========================================================
-- 5. Seed 12 starter email block templates.
--    Structurally valid Unlayer skeletons with {{token}} slots.
--    M3 hardens the JSON for visual fidelity; this seeds the row
--    inventory so the composer + agent registry have data to work
--    with from day one.
-- =========================================================

INSERT INTO "EmailBlockTemplate"
  ("id", "slug", "name", "description", "category", "unlayerDesignJsonTemplate", "placeholders", "compatibleAfter", "createdAt", "updatedAt")
VALUES
  ('blk_hero_image_top', 'hero_image_top',
   'Hero (image + heading + CTA)',
   'Full-width hero image with bold heading, subheading, and prominent call-to-action button. Use at the very top of a campaign.',
   'HERO',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"image","values":{"src":{"url":"{{image_url}}"},"altText":"{{heading}}"}},
      {"type":"heading","values":{"headingType":"h1","text":"{{heading}}","textAlign":"center"}},
      {"type":"text","values":{"text":"{{subheading}}","textAlign":"center"}},
      {"type":"button","values":{"href":{"values":{"href":"{{cta_url}}"}},"text":"{{cta_label}}","textAlign":"center"}}
   ]}]}'::jsonb,
   '[{"key":"image_url","type":"image","required":true},{"key":"heading","type":"text","maxLength":60,"required":true},{"key":"subheading","type":"text","maxLength":160},{"key":"cta_label","type":"text","maxLength":30,"required":true},{"key":"cta_url","type":"url","required":true}]'::jsonb,
   ARRAY[]::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_hero_text_only', 'hero_text_only',
   'Hero (text only)',
   'Bold heading + intro paragraph + CTA. No image. Clean and fast — works when you don''t have a hero image.',
   'HERO',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"heading","values":{"headingType":"h1","text":"{{heading}}","textAlign":"left"}},
      {"type":"text","values":{"text":"{{intro}}","textAlign":"left"}},
      {"type":"button","values":{"href":{"values":{"href":"{{cta_url}}"}},"text":"{{cta_label}}","textAlign":"left"}}
   ]}]}'::jsonb,
   '[{"key":"heading","type":"text","maxLength":60,"required":true},{"key":"intro","type":"text","maxLength":280,"required":true},{"key":"cta_label","type":"text","maxLength":30,"required":true},{"key":"cta_url","type":"url","required":true}]'::jsonb,
   ARRAY[]::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_image_text_split', 'image_text_split',
   'Image + text split',
   'Image on the left, text on the right. Great for product features or step-by-step explanations.',
   'CONTENT',
   '{"cells":[1,1],"columns":[
      {"contents":[{"type":"image","values":{"src":{"url":"{{image_url}}"},"altText":"{{heading}}"}}]},
      {"contents":[
        {"type":"heading","values":{"headingType":"h2","text":"{{heading}}"}},
        {"type":"text","values":{"text":"{{body}}"}}
      ]}
   ]}'::jsonb,
   '[{"key":"image_url","type":"image","required":true},{"key":"heading","type":"text","maxLength":80,"required":true},{"key":"body","type":"text","maxLength":400,"required":true}]'::jsonb,
   ARRAY['hero_image_top','hero_text_only']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_text_image_split', 'text_image_split',
   'Text + image split (reversed)',
   'Text on the left, image on the right. Mirror of image_text_split — use both to alternate down the page.',
   'CONTENT',
   '{"cells":[1,1],"columns":[
      {"contents":[
        {"type":"heading","values":{"headingType":"h2","text":"{{heading}}"}},
        {"type":"text","values":{"text":"{{body}}"}}
      ]},
      {"contents":[{"type":"image","values":{"src":{"url":"{{image_url}}"},"altText":"{{heading}}"}}]}
   ]}'::jsonb,
   '[{"key":"heading","type":"text","maxLength":80,"required":true},{"key":"body","type":"text","maxLength":400,"required":true},{"key":"image_url","type":"image","required":true}]'::jsonb,
   ARRAY['image_text_split']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_three_columns_features', 'three_columns_features',
   'Three feature columns',
   'Three small columns each with an icon, short heading, and short description. Great for highlighting 3 features or steps.',
   'CONTENT',
   '{"cells":[1,1,1],"columns":[
      {"contents":[
        {"type":"image","values":{"src":{"url":"{{icon_1}}"},"altText":"{{heading_1}}"}},
        {"type":"heading","values":{"headingType":"h3","text":"{{heading_1}}","textAlign":"center"}},
        {"type":"text","values":{"text":"{{body_1}}","textAlign":"center"}}
      ]},
      {"contents":[
        {"type":"image","values":{"src":{"url":"{{icon_2}}"},"altText":"{{heading_2}}"}},
        {"type":"heading","values":{"headingType":"h3","text":"{{heading_2}}","textAlign":"center"}},
        {"type":"text","values":{"text":"{{body_2}}","textAlign":"center"}}
      ]},
      {"contents":[
        {"type":"image","values":{"src":{"url":"{{icon_3}}"},"altText":"{{heading_3}}"}},
        {"type":"heading","values":{"headingType":"h3","text":"{{heading_3}}","textAlign":"center"}},
        {"type":"text","values":{"text":"{{body_3}}","textAlign":"center"}}
      ]}
   ]}'::jsonb,
   '[{"key":"icon_1","type":"image"},{"key":"heading_1","type":"text","maxLength":40,"required":true},{"key":"body_1","type":"text","maxLength":140,"required":true},{"key":"icon_2","type":"image"},{"key":"heading_2","type":"text","maxLength":40,"required":true},{"key":"body_2","type":"text","maxLength":140,"required":true},{"key":"icon_3","type":"image"},{"key":"heading_3","type":"text","maxLength":40,"required":true},{"key":"body_3","type":"text","maxLength":140,"required":true}]'::jsonb,
   ARRAY['hero_image_top','hero_text_only','image_text_split']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_single_cta_button', 'single_cta_button',
   'Centered CTA button',
   'A single bold call-to-action button centered on the row. Use mid-campaign to drive a clear action.',
   'CTA',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"text","values":{"text":"{{intro}}","textAlign":"center"}},
      {"type":"button","values":{"href":{"values":{"href":"{{cta_url}}"}},"text":"{{cta_label}}","textAlign":"center"}}
   ]}]}'::jsonb,
   '[{"key":"intro","type":"text","maxLength":140},{"key":"cta_label","type":"text","maxLength":30,"required":true},{"key":"cta_url","type":"url","required":true}]'::jsonb,
   ARRAY['image_text_split','three_columns_features','text_paragraph']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_quote_block', 'quote_block',
   'Testimonial / quote',
   'A standout quote block with attribution. Use for customer testimonials or notable lines from the brand.',
   'CONTENT',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"text","values":{"text":"\"{{quote}}\"","textAlign":"center","fontStyle":"italic"}},
      {"type":"text","values":{"text":"— {{attribution}}","textAlign":"center"}}
   ]}]}'::jsonb,
   '[{"key":"quote","type":"text","maxLength":400,"required":true},{"key":"attribution","type":"text","maxLength":80,"required":true}]'::jsonb,
   ARRAY['hero_image_top','image_text_split','three_columns_features']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_image_grid_2x2', 'image_grid_2x2',
   '2×2 image grid',
   'Four images in a 2×2 grid. Good for product line-ups, photo galleries, or event recaps.',
   'MEDIA',
   '{"cells":[1,1],"columns":[
      {"contents":[
        {"type":"image","values":{"src":{"url":"{{image_1}}"},"altText":"{{alt_1}}"}},
        {"type":"image","values":{"src":{"url":"{{image_3}}"},"altText":"{{alt_3}}"}}
      ]},
      {"contents":[
        {"type":"image","values":{"src":{"url":"{{image_2}}"},"altText":"{{alt_2}}"}},
        {"type":"image","values":{"src":{"url":"{{image_4}}"},"altText":"{{alt_4}}"}}
      ]}
   ]}'::jsonb,
   '[{"key":"image_1","type":"image","required":true},{"key":"alt_1","type":"text","maxLength":80},{"key":"image_2","type":"image","required":true},{"key":"alt_2","type":"text","maxLength":80},{"key":"image_3","type":"image","required":true},{"key":"alt_3","type":"text","maxLength":80},{"key":"image_4","type":"image","required":true},{"key":"alt_4","type":"text","maxLength":80}]'::jsonb,
   ARRAY['hero_text_only','image_text_split']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_spacer_divider', 'spacer_divider',
   'Spacer / divider',
   'Vertical breathing room with an optional thin horizontal rule. Use between sections to give the eye a rest.',
   'DIVIDER',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"divider","values":{"width":"100%","border":{"borderTopWidth":"1px","borderTopColor":"#E5E7EB","borderTopStyle":"solid"}}}
   ]}]}'::jsonb,
   '[]'::jsonb,
   ARRAY[]::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_text_paragraph', 'text_paragraph',
   'Plain text paragraph',
   'A clean text block. Use when you just need to say something without imagery or structure.',
   'CONTENT',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"text","values":{"text":"{{body}}","textAlign":"left"}}
   ]}]}'::jsonb,
   '[{"key":"body","type":"text","maxLength":1200,"required":true}]'::jsonb,
   ARRAY['hero_image_top','hero_text_only','quote_block']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_numbered_list', 'numbered_list',
   'Numbered list',
   'A short ordered list — good for steps, tips, or top-N rundowns.',
   'CONTENT',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"heading","values":{"headingType":"h2","text":"{{heading}}"}},
      {"type":"text","values":{"text":"1. {{item_1}}\n2. {{item_2}}\n3. {{item_3}}\n4. {{item_4}}\n5. {{item_5}}","textAlign":"left"}}
   ]}]}'::jsonb,
   '[{"key":"heading","type":"text","maxLength":80,"required":true},{"key":"item_1","type":"text","maxLength":160,"required":true},{"key":"item_2","type":"text","maxLength":160,"required":true},{"key":"item_3","type":"text","maxLength":160},{"key":"item_4","type":"text","maxLength":160},{"key":"item_5","type":"text","maxLength":160}]'::jsonb,
   ARRAY['hero_text_only','text_paragraph']::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_footer_minimal', 'footer_minimal',
   'Footer (minimal)',
   'Logo, physical address, and the mandatory unsubscribe link. Composer auto-injects this if missing — CAN-SPAM requires it.',
   'FOOTER',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"image","values":{"src":{"url":"{{logo_url}}"},"altText":"{{brand_name}}","width":120,"textAlign":"center"}},
      {"type":"text","values":{"text":"{{brand_name}} · {{address}}","textAlign":"center","fontSize":"12px"}},
      {"type":"text","values":{"text":"<a href=\"{{unsubscribe_url}}\">Unsubscribe</a> · <a href=\"{{webview_url}}\">View in browser</a>","textAlign":"center","fontSize":"12px"}}
   ]}]}'::jsonb,
   '[{"key":"logo_url","type":"image"},{"key":"brand_name","type":"text","required":true},{"key":"address","type":"text","required":true},{"key":"unsubscribe_url","type":"url","required":true},{"key":"webview_url","type":"url","required":true}]'::jsonb,
   ARRAY[]::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

  ('blk_footer_social', 'footer_social',
   'Footer (with social links)',
   'Logo, social icons, address, unsubscribe. Use when the brand wants social-follow exposure on every send.',
   'FOOTER',
   '{"cells":[1],"columns":[{"contents":[
      {"type":"image","values":{"src":{"url":"{{logo_url}}"},"altText":"{{brand_name}}","width":120,"textAlign":"center"}},
      {"type":"social","values":{"icons":{"editor":{"data":{"showDefaultIcons":false}}},"icons2":[{"url":"{{social_url_1}}","name":"{{social_label_1}}"},{"url":"{{social_url_2}}","name":"{{social_label_2}}"}],"align":"center"}},
      {"type":"text","values":{"text":"{{brand_name}} · {{address}}","textAlign":"center","fontSize":"12px"}},
      {"type":"text","values":{"text":"<a href=\"{{unsubscribe_url}}\">Unsubscribe</a> · <a href=\"{{webview_url}}\">View in browser</a>","textAlign":"center","fontSize":"12px"}}
   ]}]}'::jsonb,
   '[{"key":"logo_url","type":"image"},{"key":"brand_name","type":"text","required":true},{"key":"address","type":"text","required":true},{"key":"social_url_1","type":"url"},{"key":"social_label_1","type":"text"},{"key":"social_url_2","type":"url"},{"key":"social_label_2","type":"text"},{"key":"unsubscribe_url","type":"url","required":true},{"key":"webview_url","type":"url","required":true}]'::jsonb,
   ARRAY[]::TEXT[],
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
