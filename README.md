# Getyn Campaigns

Multi-tenant B2B SaaS for email, WhatsApp, and SMS marketing campaigns with an AI copilot and drag-and-drop email template builder.

> **Status:** Phase 3 shipped — Email Builder, Send Pipeline, Campaign Analytics. Phases 1 and 2 (foundations + audience) live. Phases 4-7 (WhatsApp, SMS, AI copilot, Stripe billing) up next.

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
