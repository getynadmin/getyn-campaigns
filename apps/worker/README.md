# @getyn/worker

Background job consumer for Getyn Campaigns. Long-running Node process that
reads from BullMQ queues backed by Upstash Redis, runs jobs against the
shared Supabase Postgres + Storage, and emits progress events back to the
web app via the database.

> **Why a separate process?** Vercel serverless functions are short-lived
> (15s default, 300s max on paid tiers) and aren't designed to consume
> queues continuously. Imports and email sends are I/O-bound and can take
> minutes. We host the worker on Railway, where a process can run for
> weeks at a time.

## Queues

| Queue      | Phase | Producer                       | Job types                                     |
| ---------- | ----- | ------------------------------ | --------------------------------------------- |
| `imports`  | 2     | `apps/web` → `imports.start`   | `processImport`                               |
| `sends`    | 3     | `apps/web` → `campaign.sendNow` / `campaign.schedule`; chained from `prepare-campaign` | `prepare-campaign`, `dispatch-batch`, `evaluate-ab` |
| `webhooks` | 3     | `apps/web` → Resend webhook receiver  | `process-resend-event`                 |
| `cron`     | 3     | self (BullMQ repeatable jobs)  | `daily-reset`, `rates-drift`                  |

`sends` and `webhooks` are live as of Phase 3 M6/M7. `cron` runs two
repeatable jobs registered on worker boot:

- `daily-reset` (00:00 UTC) — zeros every `TenantSendingPolicy.currentDailyCount`,
  resumes campaigns that paused on yesterday's daily cap.
- `rates-drift` (every hour at :05) — recomputes
  `cachedComplaintRate30d` / `cachedBounceRate30d` /
  `cachedSendCount30d` from raw `CampaignEvent` rows so the suspension
  decision counters don't drift from the incremental updates the
  webhook handler does.

## Env vars

| Name | Required | Notes |
| ---- | -------- | ----- |
| `NODE_ENV` | yes (in prod) | `production` on Railway, `development` locally |
| `DATABASE_URL` | yes | Supabase **pooled** URL (port 6543, `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | yes | Supabase **direct** URL (port 5432) — Prisma uses this for some operations |
| `REDIS_URL` | yes (in prod) | Upstash `rediss://default:...@host:6379` (TLS). Optional in dev — when unset, worker logs a warning and exits 0 so the web app can still run. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes for imports | Supabase project URL — worker reads CSVs from Storage |
| `SUPABASE_SERVICE_ROLE_KEY` | yes for imports | Bypasses Storage RLS so the worker can download any tenant's CSV. The worker still validates `ImportJob.tenantId` in code before reading. |
| `WORKER_IMPORTS_CONCURRENCY` | no (default 2) | Parallel `imports` jobs. Increase on bigger Railway plans. |
| `PORT` | no (default 8080) | Health endpoint port. Railway injects this automatically. |
| `RESEND_API_KEY` | yes for Phase 3 sends | Resend's REST API key. When unset, the dispatch handler logs intended sends and stamps `messageId="stub-{sendId}"` so dev exercises the full pipeline without burning Resend quota. |
| `EMAIL_TOKEN_SECRET` | yes for Phase 3 | 32+ char random string. HMAC secret for `/u/{token}` and `/v/{token}` URLs in every email. Rotating invalidates all outstanding tokens — treat as a database password. |
| `NEXT_PUBLIC_APP_URL` | yes for Phase 3 | Used by the render pipeline to absolute-URL the unsubscribe / web-view / tracking-pixel / `/r/` redirector links. |

## Health endpoint

The worker binds an HTTP listener on `PORT` and serves a single route:

```
GET /health → 200 with JSON {
  ok: boolean,                         // true when redis=ready AND every BullMQ Worker is running
  redis: 'ready' | 'connecting' | ...,
  queues: [{ name, running, concurrency }],
  uptimeSeconds: number,
  version: string
}
```

Railway's deployment health check is wired to this path via `railway.json`
(timeout 30s, restart on failure up to 3 times). Anything other than 200
keeps the deploy in "deploying" state and triggers a rollback after the
timeout.

## Local development

```bash
# 1. Make sure REDIS_URL is in `.env.local` at the repo root
#    (Upstash free tier works; mirror prod's URL if you don't want a
#    separate dev instance).

# 2. From the repo root:
corepack pnpm dev
#    Runs the web app + worker in parallel via Turbo. The worker hot-reloads
#    via `tsx watch` whenever a `.ts` file in apps/worker/src changes.

# To run the worker on its own:
corepack pnpm --filter @getyn/worker dev
```

If `REDIS_URL` is unset, the worker prints a warning and exits 0 — the web
app keeps running. This is intentional so devs working on non-import
features don't need Upstash configured.

## Production deploy on Railway

Railway is the production host for the worker. We chose Railway because it
runs long-lived Node processes, has first-class GitHub integration, and is
cheap at our scale (~$5/mo for the smallest plan, which is plenty for
Phase 3 traffic).

### One-time setup

1. **Sign up / log in** at <https://railway.app>.

2. **New Project → Deploy from GitHub repo** → pick
   `getynadmin/getyn-campaigns`. Authorize Railway's GitHub app for the
   org if prompted (read-only repo access).

3. Railway auto-detects the Nixpacks builder and reads `railway.json` at
   the repo root. The relevant lines:

   ```json
   {
     "build": {
       "buildCommand": "corepack enable && corepack pnpm install --frozen-lockfile"
     },
     "deploy": {
       "startCommand": "corepack pnpm --filter @getyn/worker start",
       "healthcheckPath": "/health",
       "healthcheckTimeout": 30
     }
   }
   ```

   You don't need to override these in the Railway UI — they're versioned
   alongside the code.

4. **Set env vars** (Railway → Project → Service → Variables):

   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://...:6543/postgres?pgbouncer=true&connection_limit=1
   DIRECT_URL=postgresql://...:5432/postgres
   REDIS_URL=rediss://default:...@enabling-prawn-77543.upstash.io:6379
   NEXT_PUBLIC_SUPABASE_URL=https://qcjyfhycnoykgnrjfxko.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key from Supabase API settings>
   WORKER_IMPORTS_CONCURRENCY=2
   ```

   `PORT` is set by Railway automatically — don't override.

5. **Deploy**. Railway pulls the linked GitHub repo at the default branch
   (`main`), runs the build command, then the start command. First build
   is slow (5-7 min — `pnpm install` cold cache + Prisma generate).
   Subsequent deploys are 1-2 min.

6. **Verify** in the Railway logs:

   ```
   [worker] redis connected
   [worker:imports] ready (concurrency=2)
   [worker] health endpoint listening on :8080/health
   ```

7. **Connect Railway → GitHub auto-deploy**: by default Railway redeploys
   on every push to `main`. To gate this behind PRs, change the deploy
   trigger to "Pull Requests merged into main" in the Railway service
   settings.

### Scaling

Phase 2 imports run fine on the smallest Railway plan (~$5/mo). For
Phase 3's send pipeline the bottleneck is Resend's API rate limit, not
worker CPU — adding more replicas helps mostly with parallelism on the
web side calling out. Suggested defaults:

- **Phase 3 launch**: 2 replicas, concurrency 2 each → 4 parallel jobs
- **At 10k+ contacts/day sustained**: bump to 3 replicas, concurrency 3

Vertical scaling (bigger instance) is rarely the right move — the worker
is mostly waiting on network I/O.

## Operations runbook

### Inspecting logs

Railway → Project → Service → **Deployments** tab → click the latest
deploy → **View Logs**. Logs are streamed live; `Cmd+F` works in-page for
search. For older logs, use the Railway CLI:

```bash
railway logs --service worker --deployment <id>
```

### Draining a queue (e.g. before a breaking schema change)

Pause new jobs at the producer side first (in the web app), then let the
worker drain. To check queue depth:

```bash
# From any machine with REDIS_URL:
corepack pnpm --filter @getyn/worker exec npx bullmq-cli drain imports
```

Or via the BullMQ Pro Dashboard (paid) for a UI. For now we use the CLI;
when traffic warrants, revisit.

### Manually retrying a failed job

```typescript
// In a one-off `tsx` shell from the worker directory:
import { Queue } from 'bullmq';
import { createRedisConnection } from './src/redis.js';

const conn = createRedisConnection(process.env.REDIS_URL);
const q = new Queue('imports', { connection: conn });
const job = await q.getJob('<jobId>');
await job?.retry();
```

For Phase 3's `sends` queue, we'll add a tRPC procedure
(`campaign.retryFailedSends`) so this doesn't require shell access.

### Rolling back a bad deploy

Two options:

1. **Railway dashboard** → Deployments → find the last green deploy →
   "Redeploy". Railway preserves build artifacts for the last ~10 deploys.

2. **GitHub revert** → push a revert commit on `main` → Railway picks it
   up automatically via the GitHub integration.

Option 1 is faster (no rebuild). Option 2 is correct if the issue is in
the code, not the deploy itself.

### What to do if a tenant gets suspended (Phase 3 M6)

The send pipeline auto-suspends a tenant when complaint or bounce rates
exceed `TenantSendingPolicy` thresholds. To lift the suspension:

```sql
UPDATE "TenantSendingPolicy"
   SET "suspendedAt" = NULL,
       "suspensionReason" = NULL
 WHERE "tenantId" = '<id>';
```

Document the resolution (who lifted, why) in the tenant's notes. Repeat
offenders should be moved to a stricter `dailySendLimit` rather than
re-suspended.

## Architecture decisions

- **Why Nixpacks over Dockerfile?** Smaller config surface; Railway
  maintains the Nixpacks build chain so we don't have to. If we ever need
  a custom system package (libvips for image processing, headless Chrome
  for screenshots), we'll switch to a Dockerfile then.
- **Why corepack rather than `npm i -g pnpm`?** Pins the pnpm version to
  whatever's in `package.json#packageManager` — same on every machine,
  no version drift between dev and prod.
- **Why no Prisma migrate on worker boot?** Migrations run from the web
  app's deploy pipeline (Vercel), not the worker. Two services applying
  migrations races.
- **Sentry (Phase 4 M0).** `@sentry/node` initialises from
  `SENTRY_DSN_WORKER`. Every BullMQ `failed` event is captured with
  tags `queue`, `jobName`, `failure: 'job_failed'`, plus extras
  `jobId`, `attemptsMade`, and `tenantId` when the job carries it.
  Alert rules live in `/sentry.alerts.json` at repo root and must be
  reflected in Sentry's UI. Shutdown flushes Sentry with a 5s budget
  before exit.

## Encryption keys (Phase 4 M1)

WABA tokens, SMS provider creds, and any future sensitive secrets
encrypt at the application layer with AES-256-GCM via `@getyn/crypto`.

- **`ENCRYPTION_KEY`**: 32-byte base64 (`openssl rand -base64 32`).
  Same value on web + worker; the worker decrypts during send/poll,
  the web app encrypts at write time.
- **Key rotation**: ciphertexts carry a `keyVersion`. Add the new key
  as `ENCRYPTION_KEY_V2` (or whatever version), keep the old key
  available for decryption, run a backfill that re-encrypts under the
  new version, then retire the old key. Never delete an old key while
  any ciphertext at that version still exists.
- **Associated data**: every encrypt/decrypt call passes `tenantId`
  as AD. Bypassing tRPC and reading another tenant's ciphertext fails
  decryption — defence in depth on top of RLS.
