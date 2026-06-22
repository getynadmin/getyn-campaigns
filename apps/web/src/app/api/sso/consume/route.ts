/* eslint-disable no-console */
/**
 * AdminCentral → Campaigns SSO landing route.
 *
 *   GET /sso?sso=<payloadB64Url>.<hmacB64Url>
 *
 * Flow:
 *   1. Verify the HMAC + payload shape + expiry.
 *   2. Upsert Tenant (by tenantId from token) — name + owner email.
 *   3. Upsert User (by email).
 *   4. Upsert Membership with the requested role.
 *   5. Write/refresh a TenantLimitOverride for EMAILS_PER_MONTH so the
 *      AdminCentral plan quota wins over the local Plan feature value.
 *      This is what makes plan upgrades / downgrades propagate
 *      automatically on the next SSO login.
 *   6. Mint a Supabase magic-link via service-role
 *      `auth.admin.generateLink` and 302 the browser at it. Supabase
 *      finishes the session and lands the user back at `/` which does
 *      post-auth routing into the tenant.
 *
 * On any failure → 302 to /login?sso_error=<reason>.
 */
import { redirect } from 'next/navigation';
import { Prisma, Role, PlanMetric, prisma } from '@getyn/db';
import type { NextRequest } from 'next/server';

import { getSupabaseAdmin } from '@/server/auth/supabase-admin';
import { verifySsoToken } from '@/server/auth/sso-token';
import { appBaseUrl } from '@/server/auth/auth0';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function loginErrorRedirect(reason: string): never {
  redirect(`/login?sso_error=${encodeURIComponent(reason)}`);
}

/**
 * Next's `redirect()` works by throwing a sentinel error with a
 * `digest` starting with "NEXT_REDIRECT". A try/catch around code
 * that calls `loginErrorRedirect` would otherwise swallow that
 * sentinel and mask the original reason. Re-throw it so the
 * framework can finish the redirect.
 */
function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/** Slugify a tenant name for the URL fragment. Falls back to a
 *  random suffix on collision. */
function slugFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'workspace'
  );
}

async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const collision = await prisma.tenant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!collision) return candidate;
  }
  throw new Error('Could not generate a unique tenant slug after 6 tries.');
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = new URL(req.url).searchParams.get('sso');
  if (!token) {
    loginErrorRedirect('missing_token');
  }

  const verdict = verifySsoToken(token);
  if (!verdict.ok) {
    console.warn(`[sso] token rejected: ${verdict.reason}`, verdict.detail);
    loginErrorRedirect(verdict.reason);
  }
  const { payload } = verdict;
  const role = payload.role === 'owner' ? Role.OWNER : Role.EDITOR;

  // 1. Upsert Tenant. We trust `tenantId` from AdminCentral as the
  //    cross-app primary key — if it's already in our DB we update
  //    the display name + ownerEmail-derived fields.
  let tenantSlug: string;
  try {
    const existing = await prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true, slug: true, name: true },
    });
    if (existing) {
      // Update name only if it diverged. Slug stays sticky — users
      // typically expect their existing URL to keep working.
      if (existing.name !== payload.name) {
        await prisma.tenant.update({
          where: { id: existing.id },
          data: { name: payload.name },
        });
      }
      tenantSlug = existing.slug;
    } else {
      // The HMAC-verified token IS the authorization. The original
      // `provision: false` gate was over-cautious — if AdminCentral
      // sent us here with a valid signature, the user is entitled to
      // a tenant in Campaigns. Always provision.
      tenantSlug = await uniqueSlug(slugFromName(payload.name));
      await prisma.tenant.create({
        data: {
          id: payload.tenantId, // AdminCentral controls the id
          slug: tenantSlug,
          name: payload.name,
        },
      });
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[sso] tenant upsert failed', err);
    loginErrorRedirect('tenant_upsert_failed');
  }

  // 2. Upsert User by email.
  let userId: string;
  try {
    const upserted = await prisma.user.upsert({
      where: { email: payload.email },
      update: { name: payload.email === payload.ownerEmail ? payload.name : undefined },
      create: {
        email: payload.email,
        name: payload.email === payload.ownerEmail ? payload.name : null,
      },
      select: { id: true },
    });
    userId = upserted.id;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[sso] user upsert failed', err);
    loginErrorRedirect('user_upsert_failed');
  }

  // 3. Upsert Membership. The Membership PK is (userId, tenantId).
  try {
    await prisma.membership.upsert({
      where: { userId_tenantId: { userId, tenantId: payload.tenantId } },
      // Only the role can change. We do NOT downgrade an existing
      // OWNER to EDITOR even if the token says member — owner status
      // in our system is sticky once granted (AdminCentral can
      // explicitly demote via the team page in-app if needed).
      update: { role: role === Role.OWNER ? Role.OWNER : undefined },
      create: { userId, tenantId: payload.tenantId, role },
    });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[sso] membership upsert failed', err);
    loginErrorRedirect('membership_upsert_failed');
  }

  // 4. Refresh the EMAILS_PER_MONTH quota override. AdminCentral is
  //    the source of truth — its value wins via resolve-limits.ts's
  //    override-first lookup. Idempotent: delete any prior
  //    SSO-tagged row and write a fresh one with the current
  //    `emailsAllowed`. Staff manual overrides (with a different
  //    `reason`) are not touched.
  try {
    await prisma.$transaction([
      prisma.tenantLimitOverride.deleteMany({
        where: {
          tenantId: payload.tenantId,
          metric: PlanMetric.EMAILS_PER_MONTH,
          reason: { startsWith: 'AdminCentral SSO:' },
        },
      }),
      prisma.tenantLimitOverride.create({
        data: {
          tenantId: payload.tenantId,
          metric: PlanMetric.EMAILS_PER_MONTH,
          included: payload.plan.emailsAllowed,
          reason: `AdminCentral SSO: plan=${payload.plan.slug} (${payload.plan.name})`,
          // null = permanent; refreshed on every SSO login.
        },
      }),
    ]);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2003'
    ) {
      // Tenant FK violation — shouldn't happen at this point but
      // log defensively rather than 500.
      console.error('[sso] limit override FK failure', err);
    } else {
      console.error('[sso] limit override write failed', err);
    }
    // Non-fatal — user can still log in; quota falls back to plan
    // feature value. Continue.
  }

  // 5. Mint a Supabase magic-link with the service-role admin client.
  //    `email_confirm: true` short-circuits the email-out step; we
  //    consume the link directly via the 302.
  let actionLink: string;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: payload.email,
      options: { redirectTo: `${appBaseUrl()}/` },
    });
    if (error || !data.properties?.action_link) {
      console.error('[sso] magic-link generation failed', error);
      loginErrorRedirect('session_mint_failed');
    }
    actionLink = data.properties.action_link;
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    console.error('[sso] magic-link generation threw', err);
    loginErrorRedirect('session_mint_failed');
  }

  // 6. Redirect into Supabase's auth callback. Supabase finishes the
  //    session + bounces back to `/`, which routes by membership.
  return Response.redirect(actionLink, 302);
}
