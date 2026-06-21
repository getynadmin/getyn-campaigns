/**
 * Email Verifier — scan contact emails for likely-bad addresses and
 * surface them for bulk cleanup.
 *
 * Five categories (each independent; a single contact can hit
 * multiple, in which case it lands in the highest-priority bucket):
 *
 *   1. INVALID_SYNTAX  — fails strict email regex
 *   2. ALREADY_BOUNCED — has at least one BOUNCED CampaignSend
 *   3. TYPO_SUSPICIOUS — domain matches a known typo (gmial.com,
 *      gmail.comw, etc.) — these usually look obvious to a human but
 *      slip past basic validation
 *   4. DISPOSABLE      — domain is on the throwaway-email list
 *   5. ROLE_BASED      — local part is admin/info/no-reply/etc.
 *
 * The scan loads every active contact for the tenant in one query +
 * one query for bounced emails. ~18k contacts complete in ~1.5s on
 * a warm Vercel function. Above ~50k contacts we'd want to chunk +
 * stream, flagged for follow-up.
 */
import { prisma } from '@getyn/db';

import { DISPOSABLE_DOMAINS, TYPO_DOMAINS } from './disposable-domains';
import { probeMxBulk, type MxStatus } from './mx-check';

export type FlagCategory =
  | 'INVALID_SYNTAX'
  | 'ALREADY_BOUNCED'
  | 'TYPO_SUSPICIOUS'
  | 'DISPOSABLE'
  | 'ROLE_BASED'
  | 'DEAD_DOMAIN';

/** Order matters for category attribution — a contact in multiple
 *  buckets is assigned to the highest-priority one (so the totals
 *  always sum to the unique flagged-contact count).
 *
 *  DEAD_DOMAIN is placed after the cheap checks but before ROLE_BASED:
 *  a no-MX domain is a stronger signal than "looks like a role inbox". */
const CATEGORY_PRIORITY: FlagCategory[] = [
  'INVALID_SYNTAX',
  'ALREADY_BOUNCED',
  'TYPO_SUSPICIOUS',
  'DISPOSABLE',
  'DEAD_DOMAIN',
  'ROLE_BASED',
];

const STRICT_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const ROLE_LOCAL_PARTS = new Set([
  'admin',
  'administrator',
  'billing',
  'compliance',
  'contact',
  'feedback',
  'help',
  'hr',
  'info',
  'legal',
  'mail',
  'marketing',
  'no-reply',
  'noreply',
  'office',
  'postmaster',
  'press',
  'privacy',
  'root',
  'sales',
  'security',
  'service',
  'support',
  'sysadmin',
  'team',
  'webmaster',
]);

export interface ContactFlag {
  contactId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  category: FlagCategory;
  /** Free-text hint shown to the user (e.g. "gmail.comw → gmail.com"). */
  detail?: string;
}

export interface ScanSummary {
  totalContacts: number;
  totalFlagged: number;
  byCategory: Record<FlagCategory, number>;
  /** Up to 10 sample flagged contacts per category for the UI to
   *  show as preview rows. */
  samples: Record<FlagCategory, ContactFlag[]>;
  /** True only when this scan included the DNS/MX pass. The basic
   *  scan leaves DEAD_DOMAIN at 0 — clients should hide the row
   *  unless this flag is set. */
  mxChecked: boolean;
}

const EMPTY_BY_CATEGORY = (): Record<FlagCategory, number> => ({
  INVALID_SYNTAX: 0,
  ALREADY_BOUNCED: 0,
  TYPO_SUSPICIOUS: 0,
  DISPOSABLE: 0,
  ROLE_BASED: 0,
  DEAD_DOMAIN: 0,
});

const EMPTY_SAMPLES = (): Record<FlagCategory, ContactFlag[]> => ({
  INVALID_SYNTAX: [],
  ALREADY_BOUNCED: [],
  TYPO_SUSPICIOUS: [],
  DISPOSABLE: [],
  ROLE_BASED: [],
  DEAD_DOMAIN: [],
});

function parseEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return {
    local: email.slice(0, at).toLowerCase(),
    domain: email.slice(at + 1).toLowerCase(),
  };
}

function categorise(
  email: string,
  bouncedSet: Set<string>,
  mxByDomain?: Map<string, MxStatus>,
): { category: FlagCategory; detail?: string } | null {
  if (!STRICT_EMAIL_RE.test(email)) {
    return { category: 'INVALID_SYNTAX' };
  }
  if (bouncedSet.has(email.toLowerCase())) {
    return { category: 'ALREADY_BOUNCED' };
  }
  const parts = parseEmail(email);
  if (!parts) return { category: 'INVALID_SYNTAX' };
  const { local, domain } = parts;

  const typoOf = TYPO_DOMAINS[domain];
  if (typoOf) {
    return {
      category: 'TYPO_SUSPICIOUS',
      detail: `${domain} → ${typoOf}`,
    };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { category: 'DISPOSABLE', detail: domain };
  }
  // MX result is only consulted when the caller supplied it (deep scan
  // path). NO_MX is a strong signal; UNKNOWN (timeout / SERVFAIL) is
  // ignored to avoid false-positive unsubscribes on flaky DNS.
  if (mxByDomain) {
    const mx = mxByDomain.get(domain);
    if (mx === 'NO_MX') {
      return { category: 'DEAD_DOMAIN', detail: `${domain} — no MX record` };
    }
  }
  if (ROLE_LOCAL_PARTS.has(local)) {
    return { category: 'ROLE_BASED', detail: local };
  }
  return null;
}

/** Top-level scan entry. Returns a summary + samples, no mutation.
 *  Pass `mxByDomain` to enable the DEAD_DOMAIN check (deep scan). */
export async function scanTenantContacts(
  tenantId: string,
  mxByDomain?: Map<string, MxStatus>,
): Promise<ScanSummary> {
  // Fetch contacts + addresses that previously bounced in parallel.
  const [contacts, bouncedRows] = await Promise.all([
    prisma.contact.findMany({
      where: {
        tenantId,
        deletedAt: null,
        // No point flagging contacts that already won't be sent to.
        emailStatus: 'SUBSCRIBED',
        email: { not: null },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    }),
    // Distinct emails that have hard-bounced. groupBy on
    // CampaignSend.email keeps the result set small even for very
    // busy tenants.
    prisma.campaignSend.groupBy({
      by: ['email'],
      where: { tenantId, status: 'BOUNCED' },
    }),
  ]);

  const bouncedSet = new Set(bouncedRows.map((r) => r.email.toLowerCase()));
  const byCategory = EMPTY_BY_CATEGORY();
  const samples = EMPTY_SAMPLES();
  let totalFlagged = 0;

  for (const c of contacts) {
    if (!c.email) continue;
    const verdict = categorise(c.email, bouncedSet, mxByDomain);
    if (!verdict) continue;
    totalFlagged += 1;
    byCategory[verdict.category] += 1;
    if (samples[verdict.category].length < 10) {
      samples[verdict.category].push({
        contactId: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        category: verdict.category,
        detail: verdict.detail,
      });
    }
  }

  return {
    totalContacts: contacts.length,
    totalFlagged,
    byCategory,
    samples,
    mxChecked: mxByDomain !== undefined,
  };
}

/**
 * Deep variant of scanTenantContacts: first runs the cheap pass to
 * collect every unique domain across subscribed contacts, then probes
 * MX records for those domains in parallel, then re-categorises
 * everything (with DEAD_DOMAIN now in play).
 *
 * Two passes over the contact list — extra ~50ms compared to the
 * basic scan — plus the DNS probe which is the dominant cost.
 */
export async function deepScanTenantContacts(
  tenantId: string,
): Promise<ScanSummary> {
  // Collect unique domains from currently-eligible contacts.
  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      deletedAt: null,
      emailStatus: 'SUBSCRIBED',
      email: { not: null },
    },
    select: { email: true },
  });

  const domains = new Set<string>();
  for (const c of contacts) {
    if (!c.email) continue;
    const parts = parseEmail(c.email);
    if (!parts) continue;
    // Skip domains we already know about (typo/disposable land in
    // their own buckets via the cheap pass — no need to MX-probe).
    if (TYPO_DOMAINS[parts.domain]) continue;
    if (DISPOSABLE_DOMAINS.has(parts.domain)) continue;
    domains.add(parts.domain);
  }

  const mxByDomain = await probeMxBulk(domains);
  return scanTenantContacts(tenantId, mxByDomain);
}

/**
 * Apply the cleanup: mark every contact that falls into one of the
 * selected categories as UNSUBSCRIBED. Returns the count actually
 * updated (may differ from scan totals if contacts were imported /
 * deleted between scan and cleanup).
 */
export async function cleanupTenantContacts(args: {
  tenantId: string;
  categories: FlagCategory[];
}): Promise<{ updated: number }> {
  if (args.categories.length === 0) return { updated: 0 };

  // Re-walk contacts to build the ID list. Avoids a stale snapshot
  // and lets us write one UPDATE per category instead of N per
  // contact.
  const contacts = await prisma.contact.findMany({
    where: {
      tenantId: args.tenantId,
      deletedAt: null,
      emailStatus: 'SUBSCRIBED',
      email: { not: null },
    },
    select: { id: true, email: true },
  });

  const bouncedRows = await prisma.campaignSend.groupBy({
    by: ['email'],
    where: { tenantId: args.tenantId, status: 'BOUNCED' },
  });
  const bouncedSet = new Set(bouncedRows.map((r) => r.email.toLowerCase()));

  // If the cleanup includes DEAD_DOMAIN we need fresh MX data. Re-
  // probe (rather than trust a stale scan-time map) so cleanup is
  // self-contained and safe to call from anywhere.
  let mxByDomain: Map<string, MxStatus> | undefined;
  if (args.categories.includes('DEAD_DOMAIN')) {
    const domains = new Set<string>();
    for (const c of contacts) {
      if (!c.email) continue;
      const parts = parseEmail(c.email);
      if (!parts) continue;
      if (TYPO_DOMAINS[parts.domain]) continue;
      if (DISPOSABLE_DOMAINS.has(parts.domain)) continue;
      domains.add(parts.domain);
    }
    mxByDomain = await probeMxBulk(domains);
  }

  const selected = new Set(args.categories);
  const ids: string[] = [];
  for (const c of contacts) {
    if (!c.email) continue;
    const verdict = categorise(c.email, bouncedSet, mxByDomain);
    if (!verdict) continue;
    if (selected.has(verdict.category)) ids.push(c.id);
  }
  if (ids.length === 0) {
    return { updated: 0 };
  }

  const result = await prisma.contact.updateMany({
    where: { id: { in: ids }, tenantId: args.tenantId },
    data: { emailStatus: 'UNSUBSCRIBED' },
  });
  void CATEGORY_PRIORITY;

  return { updated: result.count };
}
