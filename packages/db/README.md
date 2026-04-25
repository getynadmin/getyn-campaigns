# @getyn/db

Prisma schema, generated client, migrations, RLS policies, and the dev seed for Getyn Campaigns.

## Layout

```
packages/db/
├── prisma/
│   ├── schema.prisma            # Phase 1 + Phase 2 models & enums
│   ├── seed.ts                  # `pnpm db:seed`
│   └── migrations/
│       ├── migration_lock.toml
│       ├── 0000_init/           # Phase 1 tables, enums, indexes, FKs
│       ├── 0001_rls/            # Phase 1 RLS policies
│       └── 0002_phase2_audience/
│                                # Phase 2 tables + partial unique indexes
│                                # + RLS for Contact, Tag, ContactTag,
│                                # CustomField, Segment, ImportJob,
│                                # SuppressionEntry, ContactEvent
├── scripts/
│   ├── apply-rls.ts             # Re-applies RLS + partial indexes
│   ├── verify-pooler.ts         # Smoke-test the pgBouncer pooled URL
│   └── verify-rls.ts            # Prove policies actually fire
└── src/
    └── index.ts                 # Prisma singleton + withTenant() +
                                 # emitContactEvent() + upsertSuppressionEntry()
                                 # + TenantTx type
```

## Commands

| Command                  | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `pnpm db:generate`       | Regenerate the Prisma client (`@prisma/client`)                      |
| `pnpm db:push`           | Dev: push schema to DB and (re)apply RLS policies                    |
| `pnpm db:migrate`        | Create a new migration (`prisma migrate dev --name <name>`)          |
| `pnpm db:migrate:deploy` | Prod: apply pending migrations and RLS                               |
| `pnpm db:studio`         | Prisma Studio (GUI)                                                  |
| `pnpm db:seed`           | Seed the demo Acme tenant (idempotent)                               |
| `pnpm db:rls`            | Standalone re-apply of the RLS + partial-index SQL                   |
| `pnpm db:rls:verify`     | Run 17 assertions proving RLS policies actually block cross-tenant reads/writes |

> **Dev workflow:** use `db:push` for quick iteration on the schema. Once a change is ready for review, switch to `db:migrate` so every schema change ships as a reviewable SQL file.

## Row-Level Security

Multi-tenancy is enforced at **two layers**:

1. **Application:** the tRPC context resolves the current tenant from the URL (`/t/[slug]/*`), validates membership, and refuses the request if absent.
2. **Database:** Postgres RLS policies on every tenant-owned table reject rows whose `tenantId` does not match a per-request session variable.

If the application layer slips up and forgets to filter, the database still refuses. This is our defence in depth.

### Covered tables

Phase 1: `Tenant`, `Membership`, `Invitation`.

Phase 2: `Contact`, `Tag`, `ContactTag`, `CustomField`, `Segment`, `ImportJob`, `SuppressionEntry`, `ContactEvent`.

The User table is intentionally _not_ tenant-scoped — users belong to many tenants. Access control for `User` lives in the tRPC context (only the current user is exposed).

### How the session variable is set

Every request-scoped Prisma call must run inside `withTenant(tenantId, fn)`:

```ts
import { withTenant } from '@getyn/db';

const contacts = await withTenant(ctx.tenant.id, (tx) =>
  tx.contact.findMany({ where: { deletedAt: null } }),
);
```

Under the hood, `withTenant` opens a Prisma transaction and runs:

```sql
SELECT set_config('app.current_tenant_id', $1, true);
```

The `true` flag makes the setting transaction-local, so it is automatically cleared when the transaction commits or rolls back. There is no risk of the variable leaking into a subsequent request that reuses the same pooled connection — proved by `scripts/verify-pooler.ts`.

### Policy shape

For each tenant-owned table we create a single `USING` + `WITH CHECK` policy:

```sql
CREATE POLICY contact_isolation ON "Contact"
  USING      ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());
```

- `USING` filters `SELECT`, `UPDATE`, `DELETE`
- `WITH CHECK` prevents `INSERT` / `UPDATE` from writing a different `tenantId` than the session variable

We also `FORCE ROW LEVEL SECURITY` on these tables so that even the table owner is subject to the policy — this catches missing `withTenant()` wrappers during development instead of silently leaking cross-tenant data.

#### Join-gated policy (ContactTag)

`ContactTag` is the only tenant-scoped table that doesn't carry a `tenantId` column directly. Its policy joins through `Contact` via `EXISTS`:

```sql
CREATE POLICY contacttag_isolation ON "ContactTag"
  USING (
    EXISTS (
      SELECT 1 FROM "Contact" c
      WHERE c."id" = "ContactTag"."contactId"
        AND c."tenantId" = app_current_tenant_id()
    )
  ) WITH CHECK ( … same shape … );
```

### Partial unique indexes on Contact

Prisma 5.22 cannot declare partial indexes in `schema.prisma`, so `0002_phase2_audience/migration.sql` adds them as raw SQL:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_email_unique"
  ON "Contact" ("tenantId", "email")
  WHERE "email" IS NOT NULL AND "deletedAt" IS NULL;
```

These make `(tenantId, email)` and `(tenantId, phone)` unique only when the column is non-NULL _and_ the contact isn't soft-deleted. That way a deleted contact's email can be re-used for a new contact.

### System-level calls

Signup, invite-acceptance, and the seed script run **without** a tenant context (they operate across or before any tenant exists). In those cases pass `null`:

```ts
await withTenant(null, (tx) => tx.user.create({ … }));
```

For these flows, application code must explicitly scope its own queries — RLS will not help.

## The tenant-scoping rule

> **Every future query that touches a tenant-owned table MUST go through `withTenant(tenantId, …)`.**

When a new tenant-owned model is added:

1. Add `tenantId String` + `@@index([tenantId, …])` in `schema.prisma`.
2. Add a new migration under `prisma/migrations/NNNN_<name>/migration.sql` that (after Prisma's generated DDL) runs:
   ```
   ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "X" FORCE ROW LEVEL SECURITY;
   DROP POLICY IF EXISTS … ON "X";
   CREATE POLICY … ON "X" USING (…) WITH CHECK (…);
   ```
   Put the re-runnable block under a `-- Partial unique indexes` marker so `scripts/apply-rls.ts` picks it up after `db:push`.
3. Wrap every query in `withTenant(tenantId, …)` in both tRPC routers and background jobs.
4. Extend `scripts/verify-rls.ts` with an assertion that proves cross-tenant reads return 0 rows and a wrong-tenant `INSERT` fails `WITH CHECK`.

If any of those four steps is missing, the PR is not ready.

## ContactEvent helper

Every Phase 2 mutation that modifies a contact (create, update, tag change, status flip, import, etc.) should append to `ContactEvent` so the activity timeline stays complete. Use the helper from `@getyn/db`:

```ts
import { emitContactEvent, withTenant } from '@getyn/db';

await withTenant(tenantId, async (tx) => {
  await tx.contact.update({ where: { id }, data: { … } });
  await emitContactEvent(tx, {
    tenantId,
    contactId: id,
    type: 'UPDATED',
    metadata: { changed: ['firstName', 'lastName'] },
  });
});
```

Phase 3's send pipeline will reuse the same helper for `EMAIL_SENT`, `EMAIL_OPENED`, etc. — no changes required there.

## Suppression helper

`upsertSuppressionEntry` is the only sanctioned way to write to `SuppressionEntry`. It's idempotent (the `(tenantId, channel, value)` unique key short-circuits on collision) and **does not overwrite the existing `reason`** — the first cause a row entered the list for is the most operationally interesting one. A hard bounce followed by a manual block should still log the bounce as the primary reason.

```ts
import { upsertSuppressionEntry, withTenant } from '@getyn/db';

await withTenant(tenantId, async (tx) => {
  await tx.contact.update({ where: { id }, data: { emailStatus: 'UNSUBSCRIBED' } });
  await upsertSuppressionEntry(tx, {
    tenantId,
    channel: 'EMAIL',
    value: contact.email!.toLowerCase(),
    reason: 'UNSUBSCRIBED',
    metadata: { via: 'contact_status_change', contactId: id },
  });
});
```

Returns `'created' | 'noop'` so callers (mostly tests) can assert the path taken. The contact router invokes this automatically whenever a contact's `emailStatus` / `smsStatus` / `whatsappStatus` flips to `UNSUBSCRIBED` / `BOUNCED` / `COMPLAINED`. Manual entries enter the list via the `suppression.create` tRPC mutation, which uses the same helper with `reason: MANUAL`.

> **Caller is responsible for normalising the value.** The helper does not lowercase emails or canonicalise phones — it expects the caller to have done that, because the unique key is bytewise. The Zod `suppressionCreateSchema` lowercases EMAIL values on parse so the manual path is covered; auto-paths must do the same.

## Supabase Storage — `imports` bucket

CSV import files are uploaded directly from the browser to Supabase Storage using a tenant-scoped path:

```
imports/{tenantId}/{importJobId}.csv
```

The web app issues a short-lived signed upload URL; the browser PUTs the CSV; the tRPC mutation then inserts the `ImportJob` row and enqueues the job. The worker downloads the CSV by the same path.

### One-time bucket setup

Run this once per environment (dev + staging + prod). It's idempotent.

1. **Create the bucket** — Supabase dashboard → Storage → New bucket:
   - Name: `imports`
   - Public: **off**
   - File size limit: 25 MB (Phase 2 cap; revisit in Phase 5)
   - Allowed MIME types: `text/csv`, `application/vnd.ms-excel`

2. **Apply RLS policies** — Supabase dashboard → Storage → Policies → New policy on `imports`. Create the four below (INSERT/SELECT/UPDATE/DELETE). Each checks that the first path segment after `imports/` equals the caller's current tenant id:

   ```sql
   -- INSERT: a user can only upload into imports/{their-tenant-id}/*
   CREATE POLICY "imports_insert_own_tenant"
     ON storage.objects FOR INSERT
     TO authenticated
     WITH CHECK (
       bucket_id = 'imports'
       AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true)
     );

   -- SELECT / UPDATE / DELETE: same check on USING
   CREATE POLICY "imports_select_own_tenant"
     ON storage.objects FOR SELECT TO authenticated
     USING (bucket_id = 'imports'
       AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true));

   CREATE POLICY "imports_update_own_tenant"
     ON storage.objects FOR UPDATE TO authenticated
     USING (bucket_id = 'imports'
       AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true));

   CREATE POLICY "imports_delete_own_tenant"
     ON storage.objects FOR DELETE TO authenticated
     USING (bucket_id = 'imports'
       AND (storage.foldername(name))[1] = current_setting('app.current_tenant_id', true));
   ```

   > **Why the same session variable trick?** The Storage REST layer runs inside a Postgres session per request. We set `app.current_tenant_id` the same way Prisma does (`SELECT set_config(…, true)`), and the policies read it. This keeps Storage and table RLS in lock-step without duplicating tenant-membership logic in SQL.

3. **Worker-side access.** The worker uses the Supabase **service role** key, which bypasses Storage RLS (it's Supabase's superuser). That's what we want — the worker is trusted and already validates tenant ownership in code via the `ImportJob.tenantId` column before reading the file.

### Upload flow (Phase 2 Milestone 5)

```
browser ──(1) signed URL request──▶ /api/trpc/import.createUpload
browser ──(2) PUT CSV─────────────▶ supabase storage (imports/{tenantId}/{id}.csv)
browser ──(3) finalize────────────▶ /api/trpc/import.start
                                       │
                                       ├── insert ImportJob (Prisma, RLS on)
                                       └── BullMQ: enqueueImportJob({ importJobId, tenantId })
worker ───(4) download CSV───────▶ supabase storage (service role)
worker ───(5) parse + upsert────▶ Prisma + withTenant + emitContactEvent
```

## Seed

```bash
pnpm db:seed
```

Idempotent — safe to run repeatedly; it upserts Phase 1 and Phase 2 fixtures onto the same Acme tenant.

Creates:

**Phase 1**

- Tenant `Acme Inc` (slug `acme`)
- Owner user `demo@getyn.app`
- Two pending invitations — accept URLs are printed to the console

**Phase 2**

- 5 tags (VIP, Newsletter, Beta users, High intent, Cold)
- 2 custom fields (`plan_tier` SELECT, `lifetime_value` NUMBER)
- 50 contacts with varied names, subscription statuses, sources, languages
- 38 ContactTag links distributed across the first 30 contacts
- 2 segments (Active VIPs, Recent signups) with valid RuleNode JSON
- 88 ContactEvents (50 `CREATED` + 30 `TAG_ADDED` + 8 `UNSUBSCRIBED` backfill)

## Verifying the setup

After `pnpm db:push && pnpm db:seed`, run the two verification scripts:

```bash
# Proves basic connectivity + that the pgBouncer pool behaves correctly with
# transaction-local session vars.
pnpm --filter @getyn/db exec tsx scripts/verify-pooler.ts

# Proves every Phase 2 table's RLS policy actually denies cross-tenant reads
# and a wrong-tenant INSERT is blocked by WITH CHECK.
pnpm --filter @getyn/db db:rls:verify
```

Both scripts exit non-zero on failure, so they're safe to wire into CI once we have it.
