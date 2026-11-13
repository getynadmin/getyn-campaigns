-- Phase 5.6 M8 — Marketing: Retargeting + Cart Recovery.

ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

CREATE TABLE "MarketingConfig" (
  "id"              TEXT NOT NULL DEFAULT 'singleton',
  "retargetEnabled" BOOLEAN NOT NULL DEFAULT false,
  "cartEnabled"     BOOLEAN NOT NULL DEFAULT false,
  "whatsappUrl"     TEXT,
  "defaultBcc"      TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RetargetReminder" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "delayMinutes"  INTEGER NOT NULL,
  "subject"       TEXT NOT NULL,
  "bodyHtml"      TEXT NOT NULL,
  "bcc"           TEXT,
  "enabled"       BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetargetReminder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RetargetReminder_enabled_sortOrder_idx" ON "RetargetReminder"("enabled", "sortOrder");

CREATE TABLE "RetargetSend" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "reminderId" TEXT NOT NULL,
  "recipient"  TEXT NOT NULL,
  "anchorAt"   TIMESTAMP(3) NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'sent',
  "resendId"   TEXT,
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetargetSend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetargetSend_userId_reminderId_anchorAt_key" ON "RetargetSend"("userId", "reminderId", "anchorAt");
CREATE INDEX "RetargetSend_createdAt_idx" ON "RetargetSend"("createdAt" DESC);
ALTER TABLE "RetargetSend" ADD CONSTRAINT "RetargetSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetargetSend" ADD CONSTRAINT "RetargetSend_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "RetargetReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CartRecoveryReminder" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "delayMinutes"  INTEGER NOT NULL,
  "subject"       TEXT NOT NULL,
  "bodyHtml"      TEXT NOT NULL,
  "bcc"           TEXT,
  "enabled"       BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CartRecoveryReminder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CartRecoveryReminder_enabled_sortOrder_idx" ON "CartRecoveryReminder"("enabled", "sortOrder");

CREATE TABLE "CartRecoverySend" (
  "id"         TEXT NOT NULL,
  "orderId"    TEXT NOT NULL,
  "reminderId" TEXT NOT NULL,
  "recipient"  TEXT NOT NULL,
  "anchorAt"   TIMESTAMP(3) NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'sent',
  "resendId"   TEXT,
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CartRecoverySend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CartRecoverySend_orderId_reminderId_anchorAt_key" ON "CartRecoverySend"("orderId", "reminderId", "anchorAt");
CREATE INDEX "CartRecoverySend_createdAt_idx" ON "CartRecoverySend"("createdAt" DESC);
ALTER TABLE "CartRecoverySend" ADD CONSTRAINT "CartRecoverySend_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "CartRecoveryReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the config singleton + both reminder sequences.
INSERT INTO "MarketingConfig" ("id", "retargetEnabled", "cartEnabled", "updatedAt")
VALUES ('singleton', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "RetargetReminder" ("id", "name", "delayMinutes", "subject", "bodyHtml", "enabled", "sortOrder", "updatedAt") VALUES
  ('rt_seed_1', 'Day 7 — nudge',       10080, 'Still thinking about Getyn Campaigns, {{user_name}}?', '<p>Hi {{user_name}},</p><p>Your campaigns are waiting — hop back in and pick up where you left off.</p><p><a class="btn" href="{{continue_url}}">Open {{site_name}}</a></p><p class="muted">If you have a question, just reply to this email.</p>', true, 1, CURRENT_TIMESTAMP),
  ('rt_seed_2', 'Day 14 — tips',       20160, 'A few ideas to get your first campaign out',          '<p>Hi {{user_name}},</p><p>Need inspiration? Our one-page starter guide walks through your first email + WhatsApp blast in under 10 minutes.</p><p><a class="btn" href="{{continue_url}}">Jump back in</a></p>', true, 2, CURRENT_TIMESTAMP),
  ('rt_seed_3', 'Day 30 — win-back',   43200, 'We miss you, {{user_name}} — here''s what''s new',    '<p>Hi {{user_name}},</p><p>Since you last signed in we shipped a bunch of upgrades: smarter AI subject lines, deeper analytics, unified inbox.</p><p><a class="btn" href="{{continue_url}}">See what''s new</a></p>', true, 3, CURRENT_TIMESTAMP);

INSERT INTO "CartRecoveryReminder" ("id", "name", "delayMinutes", "subject", "bodyHtml", "enabled", "sortOrder", "updatedAt") VALUES
  ('cr_seed_1', '+1 hour — forgot something?',    60,   'Did you forget something, {{user_name}}?',       '<p>Hi {{user_name}},</p><p>Looks like you stepped away before finishing checkout for <strong>{{plan_name}}</strong> ({{credits}} messages/mo for {{amount}}).</p><p><a class="btn" href="{{checkout_url}}">Resume checkout</a></p>', true, 1, CURRENT_TIMESTAMP),
  ('cr_seed_2', '+24 hours — reminder',           1440, 'Your {{plan_name}} plan is still waiting',       '<p>Hi {{user_name}},</p><p>We saved your cart. {{plan_name}} ({{credits}} messages/mo, {{amount}}) is one click away.</p><p><a class="btn" href="{{checkout_url}}">Finish signup</a></p><p class="muted">Questions? Just reply — we read every one.</p>', true, 2, CURRENT_TIMESTAMP),
  ('cr_seed_3', '+72 hours — last chance',        4320, 'Last reminder — your {{plan_name}} cart expires soon', '<p>Hi {{user_name}},</p><p>We''ll archive your cart shortly. If you still want to launch with {{plan_name}}, grab it before it''s gone.</p><p><a class="btn" href="{{checkout_url}}">Complete checkout</a></p>', true, 3, CURRENT_TIMESTAMP);
