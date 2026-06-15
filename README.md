# Getyn Campaigns

Multi-tenant B2B SaaS for email, WhatsApp, and SMS marketing campaigns with an AI copilot and drag-and-drop email template builder.

> **Status:** Phases 1–7 shipped; **Phase 7.1 M0–M1 landed** (attachment infrastructure — agents can ingest user-uploaded images, PDFs, spreadsheets, and Word docs; Audience Agent surface lands in M3).

## Phase 7.1 — Attachments + Audience Agent (in progress)

Two related extensions of the Phase 7 surface:

1. **Attachments in conversations.** Users upload PNG/JPG/WebP, PDF, CSV/XLS/XLSX, DOC/DOCX (10MB cap, magic-byte verified — claimed MIME is never trusted). The worker parses each into a structured `AgentAttachment.parsedContent` JSONB (CSV: columns + 100-row sample + per-column type guesses; PDF: text + page count; DOCX: text + headings; image: dimensions + EXIF-stripped thumbnail). A Haiku-backed summarizer ($0.05/attachment cap) produces a 2–5 sentence `aiSummary` that the conversation reuses across turns — raw file content never re-enters context after the first turn. Storage path: `agent-attachments/{tenantId}/{conversationId}/{assetId}-{filename}` (private bucket, signed URLs only; daily cleanup cron deletes after 30d if unreferenced).

2. **Audience Agent** (M3+, upcoming). New agent surface under `/t/[slug]/audience/agent/[id]`, sharing the Phase 7 runtime. Primary flow: upload CSV → agent inspects schema → proposes column mapping + filters + dedupe + tags → user approves a `ProposedImportPlan` → existing Phase 2 `ImportJob` pipeline runs.

Schema bits landed in M0: `AgentConversation.agentKind` (`CAMPAIGN_EMAIL | CAMPAIGN_WHATSAPP | AUDIENCE`), `AgentAttachment`, `AgentConversationAttachment`, `ProposedImportPlan`. New `@getyn/attachments` package isolates heavy parsers (sharp, pdf-parse, mammoth, xlsx) from the web bundle. New BullMQ queue `attachment-parse` plus daily `attachment-cleanup` cron in the worker.

## Phase 7 — AI Campaign Agents

**The flow** — tenants fill out their brand profile once at `/t/[slug]/settings/brand` (name, description, colors, voice, signature). Then from `/t/[slug]/campaigns/new` they click the gradient "Create with AI Agent" card, pick **Email** or **WhatsApp**, and land in a two-pane chat at `/t/[slug]/agent/[id]`. The agent asks a few focused questions, calls tools to assemble the campaign, and finalizes a DRAFT. The user reviews + sends through the existing pipeline.

**Brand profile** (`/t/[slug]/settings/brand`) is required before the agent can run. A dashboard nudge surfaces until it's complete. Stored in the new `TenantBrandProfile` table; read on every conversation start.

**Email agent** — picks blocks from a vetted library of 13 starter templates (`EmailBlockTemplate`), assembles a design plan, and the `composeUnlayerJson` helper produces valid Unlayer JSON the existing editor loads cleanly. CAN-SPAM footer is auto-injected if missing; brand-fidelity check flags off-brand hex codes as warnings.

**WhatsApp agent** — lists the tenant's APPROVED templates, picks one or drafts a new one via the existing Phase 4 M7 `draftWhatsAppTemplate` flow. New drafts land as `WhatsAppTemplate(status=DRAFT)` rows that the user submits to Meta from the existing editor. Campaign creation waits for Meta approval before dispatch.

**Safety rails** —
- $0.50 hard cost cap per conversation. Over the cap, the system prompt instructs the agent to call `finalize_draft` on its next turn with whatever it has.
- Per-tool consecutive-failure cap (2). After 2 errors in a row from the same tool, the runtime appends a hint telling Claude to stop retrying and ask the user.
- System prompt guardrails: no real-time data, no fake claims, no scope creep, no arbitrary hex colors.
- Brand fidelity check (HSL-aware) flags off-brand colors as warnings without blocking the draft.

**Plan metric** — `AI_AGENT_CONVERSATIONS_PER_MONTH` (Starter 10, Growth 100, Pro 500). Gated at `agent.startConversation` via the existing `assertWithinLimit` helper.

**Observability** —
- Sentry alerts (tagged `agent=true`): `agent.conversation.failed`, `agent.cost.cap_reached`, `agent.finalize.compose_failed`.
- PostHog events (server-side via direct REST POST, fired from `server/analytics/agent-events.ts`): `agent.conversation.started / completed / abandoned`.

**Conversation persistence** — `AgentConversation` + `AgentMessage` rows. Resume from `/t/[slug]/agent`; history rehydrated into Claude context (capped at last 50 messages or ~100k approx-tokens).

**Architecture sketch**:

```
packages/ai/
  agent-runtime.ts         # streaming tool-use loop, channel-agnostic
  client.ts                # Anthropic client + cost calculation
apps/web/src/server/agent/
  runner.ts                # wires runtime to Prisma + channel toolsets
  context-loader.ts        # brand profile + segments + block library
  message-store.ts         # Prisma-backed MessageStore
  email-composer.ts        # design plan → Unlayer JSON
  email-plan-renderer.ts   # design plan → preview HTML
  brand-fidelity.ts        # off-brand color check
  tools/
    set-goal.ts            # shared
    email/                 # 9 email tools
    whatsapp/              # 8 WA tools
apps/web/src/components/agent/
  agent-chat-client.tsx    # two-pane chat UI
  use-agent-stream.ts      # SSE consumer
  email-preview-pane.tsx   # iframe preview
  whatsapp-preview-pane.tsx# phone-frame mockup
```

## Phase 5.6 — Admin integrations + branding

**Sidebar structure** — `Admin Central` with Tenants, **Plan Management** (Plans, Upgrade Requests), Reports & Analytics (group placeholder), **Settings** (Plan Settings, Site Settings, Staff Users), **Global Integrations** (WhatsApp, Email SMTP, Email Templates, Sending Servers, SMS Servers), Audit log / Webhooks / Queues, plus Back to App + Sign Out. Legacy `/admin/settings` and `/admin/staff` redirect to the new locations.

**Secrets storage** — DB-first with env-var fallback. Every integration has a row in `IntegrationCredential`; non-secret config is JSON, secrets are AES-256-GCM via `@getyn/crypto` with AD `integration:{provider}`. When a row is missing or `enabled=false`, the resolver returns the env-var values, so the app keeps working before admins fill in the UI.

| Provider slug    | UI path                                       | Env-var fallbacks                                                         |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `whatsapp_meta`  | `/admin/integrations/whatsapp`                | `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| `smtp_default`   | `/admin/integrations/smtp`                    | (none — pure DB)                                                          |
| `resend`         | `/admin/integrations/sending-servers` (tab)   | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`            |
| `railway_worker` | `/admin/integrations/sending-servers` (tab)   | `WORKER_HEALTH_URL`, `RAILWAY_PROJECT_TOKEN`                              |
| `twilio`, `msg91`| `/admin/integrations/sms-servers`             | placeholders — UI shows "Coming soon"                                     |

**System email templates** — 10 seeded templates (welcome, email verification, password reset, team invite, account activated/suspended, plan upgrade requested/approved/rejected, impersonation notice). Edited at `/admin/integrations/email-templates/[id]` with live preview and "Send test". The `sendSystemEmail()` helper renders `{{var}}` substitutions (HTML-escaping body, plain subject/text) and dispatches via SMTP when enabled, falling back to Resend transactional, then console (dev).

**Site branding** — `SiteBrandingSettings` singleton with app name, four logo/favicon URLs, primary + accent colors, login tagline, footer text, and a custom-CSS override. Stored in the public `brand-assets` Supabase bucket; the root layout pulls them via `getSiteBranding()` (React cache, per-request) for `generateMetadata()`, the favicon `<link>`, and CSS variables injected at the document head. Hard-coded fallbacks mean the app never breaks on a clean install.

**Worker note** — workers still read env vars today; a 60s in-memory cache + DB lookup is the M6 follow-up. Web reads via React `cache()` per-request.

## What ships today

**Phase 1 — Foundations**: multi-tenant monorepo, Supabase Postgres + RLS, auth (email + Google), app shell, team invites.

**Phase 2 — Audience**: contacts CRUD with soft-delete + tags + custom fields, CSV imports (BullMQ worker), nested AND/OR + behavioral segments, activity timeline, suppression list.

**Phase 3 — Email**:

- **Sending domains** — Resend-verified per-tenant domains. DNS records displayed in the UI for copy-paste, verification polling, plan-gated (Growth + Pro).
- **Email builder** — Unlayer-embedded full-screen editor. Per-tenant image library backed by Supabase Storage `email-assets` bucket. Merge tags from system + custom fields. Server-side render to HTML at save time, plaintext alternative auto-generated.
- **Template library** — 8 system templates seeded (Welcome / Newsletter / Promotional / Announcement / Event / Re-engagement / Product launch / Transactional). Tenant-owned templates via "Use template" duplication.
- **Campaign wizard** — segment recipients with suppression-aware preview, design link-out, settings (subject / from / sending domain / A/B), schedule or send now. Pre-flight checks block on missing postal address, unsaved design, empty segment, content scan errors.
- **A/B subject testing** — split test cohort 10–45%, winner picked by open rate or click rate after 1–48h, held-back cohort sent with winner. Sample-size floor of 100/variant.
- **Send pipeline** — 3 BullMQ job types (prepare-campaign, dispatch-batch, evaluate-ab) with content scanner, suspension threshold guardrails (cached complaint/bounce rates), per-tenant daily caps, retry-on-Resend-429.
- **Tracking** — open pixel with bot UA filter + 1h dedup, click redirector with shared TrackingLink slugs + per-recipient `?s=` query param, RFC 8058 one-click unsubscribe, web-view URL.
- **Resend webhooks** — HMAC-verified receiver enqueues async; worker maps delivery / bounce / complaint events; hard bounces and complaints auto-suppress.
- **Analytics** — per-campaign metrics row, funnel viz, time-series chart, top links, recipients tab, A/B winner card.
- **Daily cron** — resets daily caps at 00:00 UTC, hourly drift-correction of cached suppression counters from raw events.

## Prerequisites

- **Node.js** 20.x (see `.nvmrc`)
- **pnpm** 9+
- A **Supabase** project (provides Postgres + Auth + Storage)
- _(Optional for dev)_ A **Resend** API key — without it, invitation emails are logged to the server console with the accept-invite URL.

## Tech stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Web:** Next.js 14 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui
- **API:** tRPC v11 over Next.js route handlers
- **DB:** Prisma ORM on Supabase Postgres (RLS enabled)
- **Auth:** Supabase Auth (email+password, Google OAuth)
- **Validation:** Zod (shared via `@getyn/types`)

## Workspaces

| Package          | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| `apps/web`       | Next.js 14 app (UI + tRPC API)                                  |
| `apps/worker`    | BullMQ worker for background jobs (CSV imports, later phases)   |
| `packages/db`    | Prisma schema, migrations, seed, and singleton client           |
| `packages/types` | Shared Zod schemas & inferred TypeScript types                  |
| `packages/ui`    | Shared UI primitives (placeholder in Phase 1)                   |
| `packages/config`| Shared ESLint, Tailwind preset, tsconfig base, Prettier         |

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill in Supabase credentials
cp .env.example .env
cp .env.example apps/web/.env.local   # Next.js reads from here

# 3. Generate Prisma client, push the schema, apply RLS, seed
pnpm db:generate
pnpm db:push          # Phase 1: safe; later phases use db:migrate
pnpm db:seed

# 4. Run the app
pnpm dev
```

The app runs at <http://localhost:3000>. The seed creates a demo workspace:

- **Workspace:** Acme Inc (slug: `acme`)
- **Owner:** `demo@getyn.app`
- **Pending invitations:** 2 (printed in seed output)
- **Audience fixtures:** 5 tags, 2 custom fields, 50 contacts, 2 segments, 88 ContactEvents

Once signed in, the dashboard at `/t/acme/dashboard` shows live counts for contacts, segments, and the suppression list — and the four-step onboarding checklist tracks invite → contacts → segment → channel.

## Scripts

| Command                | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `pnpm dev`             | Run every workspace's `dev` task via Turborepo                      |
| `pnpm build`           | Build all packages                                                  |
| `pnpm lint`            | Lint all packages                                                   |
| `pnpm typecheck`       | Typecheck all packages (no emit)                                    |
| `pnpm test`            | Run all tests (Vitest)                                              |
| `pnpm format`          | Prettier write                                                      |
| `pnpm db:push`         | Push Prisma schema to DB (dev)                                      |
| `pnpm db:migrate`      | Create & apply a migration                                          |
| `pnpm db:studio`       | Open Prisma Studio                                                  |
| `pnpm db:seed`         | Seed demo workspace                                                 |
| `pnpm db:rls:verify`   | Run 17 assertions proving Phase 2 RLS policies fire                 |

## Environment variables

See [`.env.example`](./.env.example). The `DATABASE_URL` should be the Supabase **pooled** URL; `DIRECT_URL` is the direct connection (required by Prisma for migrations).

## Row-Level Security

All tenant-scoped tables are protected by Postgres RLS policies keyed on a
`current_tenant_id` session variable, set per request by the app server.
Details — including the Supabase Storage policies for CSV uploads — in
[`packages/db/README.md`](./packages/db/README.md).

## Project layout

```
apps/
  web/                    Next.js app (UI + tRPC API)
  worker/                 BullMQ worker (CSV imports, future: send pipeline)
packages/
  db/                     Prisma schema, client, migrations, seed
  types/                  Shared Zod schemas (incl. queue payload shapes)
  ui/                     Shared UI primitives (P1: placeholder)
  config/                 ESLint, Tailwind preset, tsconfig, Prettier
turbo.json
pnpm-workspace.yaml
```

## Background jobs (`apps/worker`)

The worker consumes BullMQ queues. Phase 2 adds one queue — `imports` — for
CSV contact imports. Later phases will add send-pipeline queues for email,
SMS, and WhatsApp.

### Local dev

```bash
# One-time: sign up for Upstash Redis free tier → create a database →
# copy the "rediss://" URL. Paste it into .env.local as REDIS_URL.
# Free tier is enough for local dev and Phase 2 prod traffic.

pnpm dev   # runs web + worker in parallel via Turbo
```

If `REDIS_URL` is unset, the worker logs a warning and exits 0 — the web
app keeps running. This is intentional so devs who aren't touching imports
don't need Redis set up.

### Queues

| Queue     | Producer   | Consumer      | Payload shape                        |
| --------- | ---------- | ------------- | ------------------------------------ |
| `imports` | `apps/web` | `apps/worker` | `{ importJobId, tenantId }` (cuid×2) |

The payload schema lives in `packages/types/src/queues.ts` and is the
single source of truth for both producer and consumer.

### Production deploy (Railway)

Not deployed yet — Phase 2 local-only until we're ready to ship. When we
are, the steps are:

1. **Upstash Redis** — production instance (paid if traffic warrants).
   Copy the TLS URL.
2. **Railway** — new project, connect this repo, point at the monorepo root
   with `Root Directory = /` (don't set a sub-path — Railway needs access
   to the whole monorepo to resolve pnpm workspaces).
3. **Service config on Railway:**
   - Install command: `corepack enable && pnpm install --frozen-lockfile`
   - Build command: _(none — worker runs via tsx at runtime)_
   - Start command: `pnpm --filter @getyn/worker start`
4. **Env vars** (set in Railway service settings, not committed):
   `NODE_ENV=production`, `DATABASE_URL` (Supabase pooler URL),
   `DIRECT_URL` (Supabase direct URL, for Prisma's occasional non-pooled
   path), `REDIS_URL`, optionally `WORKER_IMPORTS_CONCURRENCY`.
5. **Scaling:** Railway's smallest instance handles Phase 2's import
   throughput. Scale horizontally (more replicas) before vertically.

> **Reminder:** the web app also needs `REDIS_URL` set on Vercel once the
> import UI ships — it uses the same value to enqueue jobs.
