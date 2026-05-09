# @getyn/web

Next.js 14 (App Router) front-end for Getyn Campaigns. Owns the
public site, every authenticated tenant route under `/t/[slug]/...`,
the tRPC API at `/api/trpc/[trpc]`, and the inbound webhook
receivers at `/api/webhooks/*`.

The worker (`apps/worker`) consumes the BullMQ queues this app
produces. Both share `@getyn/db`, `@getyn/types`, `@getyn/crypto`,
`@getyn/whatsapp`, `@getyn/ui`, and `@getyn/ai` from the monorepo.

---

## Local dev

```bash
pnpm install
cp .env.example .env.local   # at the repo root
pnpm --filter @getyn/web dev
```

The web app runs on `:3000`. The worker (`pnpm --filter @getyn/worker dev`)
runs on `:8080` for its `/health` endpoint.

`REDIS_URL` is optional in dev; the worker exits cleanly when unset
and import / send / WhatsApp queues silently fail at the tRPC layer
with a clear message.

---

## Phase 4 — WhatsApp setup walkthrough

The WhatsApp surface ships fully built but every feature degrades
gracefully without configuration. To exercise it end-to-end you
need three things from Meta plus an Anthropic key.

### 1. Provision a Meta app

In [Meta for Developers](https://developers.facebook.com/apps):

1. **My Apps → Create App**. Type: **Business**.
2. Add the **WhatsApp** product.
3. Add the **Facebook Login** product (required for Embedded Signup).
4. Add the **Webhooks** product.
5. From **App Settings → Basic**, copy:
   - **App ID** → `META_APP_ID` and `NEXT_PUBLIC_META_APP_ID`
   - **App Secret** → `META_APP_SECRET`

### 2. Configure Embedded Signup

In **WhatsApp → Configuration → Embedded Signup**:

1. Add a configuration. Pick **Service Provider** flow (we route
   tenants here from the empty state on `/settings/channels/whatsapp`).
2. Copy the **Configuration ID** → `META_CONFIG_ID` and
   `NEXT_PUBLIC_META_CONFIG_ID`.
3. Set the redirect to your prod origin (`https://your-host.example`).
   Local dev uses `http://localhost:3000`; add it under
   **App Domains** in App Settings → Basic.

### 3. Configure the webhook

In **Webhooks → Configuration**:

1. Pick a verify token (any non-trivial random string).
   Set it as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
2. **Callback URL**: `https://your-host.example/api/webhooks/whatsapp/<META_APP_ID>`
   (path includes the App ID so the receiver can route signature
   verification correctly when multiple apps land later).
3. Click **Verify and Save** — Meta hits our GET handler with the
   verify token + a `hub.challenge`; we echo the challenge if the
   token matches.
4. Subscribe to fields: `messages` (covers inbound + status +
   template-status events).

### 4. Enable AI drafting (optional)

`ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com).
~$0.003 per template draft on Sonnet 3.5; a $5 starter buys ~1500
generations. Without the key the "Draft with AI" button stays hidden
and manual authoring works unchanged.

### 5. Smoke test

1. Visit `/t/<your-slug>/settings/channels/whatsapp`.
2. Click **Connect with Facebook** (or **Connect manually** with a
   pasted system-user token if Embedded Signup is hitting your app
   policy).
3. Pull a real WABA in. Phone numbers + templates sync immediately.
4. Author a template at `Settings → Channels → WhatsApp → Templates →
   New template`. Submit. Watch the badge flip PENDING → APPROVED
   (Meta usually responds inside 5 min; we poll every 30s for the
   first 5 min then yield to the hourly cron).
5. Build a small segment (yourself + 1–2 colleagues with phones
   they have on WhatsApp).
6. Sidebar **Campaigns → New campaign → WhatsApp campaign**. Pick the
   template + segment + phone. Send.
7. Verify deliveries on the recipients' phones.
8. Reply from one of the phones — see the conversation appear in
   the sidebar **WhatsApp Inbox** with an unread badge. The thread
   shows your inbound message; service-window indicator opens for 24h.
9. Reply from the inbox composer. Confirm Meta delivers it.

---

## Environment variables

Reference list — full descriptions in `.env.example`.

| Var | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres | Always |
| `NEXT_PUBLIC_SUPABASE_URL` + anon | Auth | Always |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side privileged DB | Always |
| `NEXT_PUBLIC_APP_URL` | Origin for absolute URLs | Always |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` + `RESEND_WEBHOOK_SECRET` | Email send + webhook (Phase 3) | Required to send email |
| `EMAIL_TOKEN_SECRET` | HMAC for `/u/<token>` + `/v/<token>` (Phase 3) | Required to send email |
| `REDIS_URL` | BullMQ (Upstash) | Required to enqueue jobs |
| `ENCRYPTION_KEY` + `ACTIVE_KEY_VERSION` | Tenant-credential AES-256-GCM (Phase 4 M1) | Required to connect WhatsApp |
| `META_APP_SECRET` | Webhook signature verify (Phase 4 M9) | Required for inbound |
| `META_APP_ID` + `NEXT_PUBLIC_META_APP_ID` | Meta app | Required for Embedded Signup |
| `META_CONFIG_ID` + `NEXT_PUBLIC_META_CONFIG_ID` | Embedded Signup config | Required for Embedded Signup |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Webhook GET handshake | Required for inbound |
| `ANTHROPIC_API_KEY` | "Draft with AI" button | Optional |
| `SENTRY_DSN_WEB` (+ `NEXT_PUBLIC_SENTRY_DSN_WEB`) | Web error tracking | Optional |
| `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | Sentry tagging | Optional |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT_WEB` | Source-map upload | Optional (CI only) |

---

## Architecture pointers

- **`src/app/t/[slug]/...`** — every authenticated tenant page lives
  under this segment. The slug is resolved through tRPC's
  `tenantProcedure` middleware which looks up the tenant + the
  current user's membership.
- **`src/server/trpc/routers/`** — one router per resource; mounted
  on `appRouter` in `root.ts`.
- **`src/server/queues/index.ts`** — the BullMQ producer for
  every queue the worker consumes. Adding a new queue: add the name
  to `QUEUE_NAMES` in `@getyn/types`, define the payload schema, add
  a producer here, add a worker handler in `apps/worker`.
- **`src/server/whatsapp/`** — pure helpers (signature verify,
  webhook event derivation, service-window math). Import these from
  the heavier route handlers; keeps the routes thin and helps unit
  testing.
- **`@getyn/whatsapp`** package — Meta API client + reconciliation
  routines (phone refresh, template sync, template resolver) shared
  between the web app and the worker. Adding a new Meta endpoint:
  add it to `meta-client.ts` with a typed wrapper.

---

## Tests

```bash
pnpm --filter @getyn/web test       # 219 unit tests across schemas, helpers, services
pnpm --filter @getyn/web typecheck  # tsc --noEmit
pnpm --filter @getyn/web lint       # next lint
```

Tests are co-located beside their subjects (`foo.test.ts` next to
`foo.ts`). No integration / e2e harness yet — Phase 5+ may add one
once the surface stops moving so fast.
