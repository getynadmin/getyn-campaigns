/* eslint-disable no-console */
/**
 * Phase 5.6 M8 — Marketing: Retargeting + Cart Recovery runners.
 *
 * Both cadences are STAGE-BASED: each eligible subject (dormant user
 * or open cart) is picked up by the ONE reminder whose window they
 * are currently in — the latest enabled reminder with delay <= age.
 * The send ledger's unique (subject, reminderId, anchor) key makes
 * every cron tick idempotent.
 *
 * Mirrors the Getyn Builder pattern (see project_getyn_retargeting
 * memory). Ships PAUSED via MarketingConfig.
 */
import { prisma } from '@getyn/db';

import { getResendCredentials } from '@/server/integrations/resend';

type Vars = Record<string, string>;

export const RETARGET_VARS = [
  'user_name',
  'continue_url',
  'site_name',
  'whatsapp_url',
] as const;

export const CART_VARS = [
  'user_name',
  'plan_name',
  'credits',
  'amount',
  'checkout_url',
  'whatsapp_url',
  'site_name',
] as const;

const SITE_NAME = 'Getyn Campaigns';

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://campaigns.getyn.com'
  ).replace(/\/+$/, '');
}

function interpolate(template: string, vars: Vars): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, k: string) =>
    vars[k] != null ? String(vars[k]) : '',
  );
}

function renderEmail(bodyHtml: string, vars: Vars): { html: string; text: string } {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#111}
    .wrap{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb}
    .btn{display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin:12px 0}
    p{line-height:1.6}
    .muted{color:#6b7280;font-size:13px}
  </style></head><body><div class="wrap">${interpolate(bodyHtml, vars)}</div></body></html>`;
  const text = interpolate(bodyHtml, vars)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { html, text };
}

async function sendResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  bcc?: string | null;
}): Promise<{ id: string | null; error?: string }> {
  const creds = await getResendCredentials();
  if (!creds.apiKey || !creds.defaultFromEmail) {
    console.info('[marketing] Resend not configured — would send:', args.to, args.subject);
    return { id: null, error: 'Resend not configured' };
  }
  const payload: Record<string, unknown> = {
    from: creds.defaultFromEmail,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  };
  if (args.bcc) payload.bcc = args.bcc;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      return { id: null, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? null };
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getMarketingConfig(): Promise<{
  retargetEnabled: boolean;
  cartEnabled: boolean;
  whatsappUrl: string | null;
  defaultBcc: string | null;
}> {
  const row = await prisma.marketingConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
  return {
    retargetEnabled: row.retargetEnabled,
    cartEnabled: row.cartEnabled,
    whatsappUrl: row.whatsappUrl,
    defaultBcc: row.defaultBcc,
  };
}

export async function saveMarketingConfig(args: {
  retargetEnabled?: boolean;
  cartEnabled?: boolean;
  whatsappUrl?: string | null;
  defaultBcc?: string | null;
}): Promise<void> {
  await prisma.marketingConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...args },
    update: args,
  });
}

// ──────────────────────────────────────────────────────────────
// Retargeting
// ──────────────────────────────────────────────────────────────

export async function stampLastSeen(userId: string): Promise<void> {
  const THROTTLE_MIN = 5;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastSeenAt: true },
  });
  if (!row) return;
  if (row.lastSeenAt) {
    const ageMs = Date.now() - row.lastSeenAt.getTime();
    if (ageMs < THROTTLE_MIN * 60_000) return;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
  });
}

export async function runRetargeting(): Promise<{
  evaluated: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const cfg = await getMarketingConfig();
  if (!cfg.retargetEnabled) return { evaluated: 0, sent: 0, skipped: 0, errors: 0 };

  const reminders = await prisma.retargetReminder.findMany({
    where: { enabled: true },
    orderBy: { delayMinutes: 'asc' },
  });
  if (reminders.length === 0) return { evaluated: 0, sent: 0, skipped: 0, errors: 0 };

  const minDelay = Math.min(...reminders.map((r) => r.delayMinutes));
  const cutoff = new Date(Date.now() - minDelay * 60_000);

  const candidates = await prisma.user.findMany({
    where: { lastSeenAt: { lte: cutoff, not: null } },
    select: { id: true, email: true, name: true, lastSeenAt: true },
    take: 500,
  });

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of candidates) {
    if (!user.lastSeenAt) {
      skipped++;
      continue;
    }
    const ageMin = Math.floor((Date.now() - user.lastSeenAt.getTime()) / 60_000);
    // Pick the ONE reminder whose window we're in: latest with delay <= ageMin.
    const match = [...reminders].reverse().find((r) => r.delayMinutes <= ageMin);
    if (!match) {
      skipped++;
      continue;
    }

    const already = await prisma.retargetSend.findUnique({
      where: {
        userId_reminderId_anchorAt: {
          userId: user.id,
          reminderId: match.id,
          anchorAt: user.lastSeenAt,
        },
      },
    });
    if (already) {
      skipped++;
      continue;
    }

    const vars: Vars = {
      user_name: (user.name ?? user.email.split('@')[0]) || 'there',
      continue_url: siteUrl(),
      site_name: SITE_NAME,
      whatsapp_url: cfg.whatsappUrl ?? '',
    };
    const { html, text } = renderEmail(match.bodyHtml, vars);
    const subject = interpolate(match.subject, vars);
    const result = await sendResend({
      to: user.email,
      subject,
      html,
      text,
      bcc: match.bcc ?? cfg.defaultBcc,
    });
    try {
      await prisma.retargetSend.create({
        data: {
          userId: user.id,
          reminderId: match.id,
          recipient: user.email,
          anchorAt: user.lastSeenAt,
          status: result.error ? 'failed' : 'sent',
          resendId: result.id,
          error: result.error ?? null,
        },
      });
      if (result.error) errors++;
      else sent++;
    } catch {
      skipped++;
    }
  }

  return { evaluated: candidates.length, sent, skipped, errors };
}

// ──────────────────────────────────────────────────────────────
// Cart Recovery
// ──────────────────────────────────────────────────────────────

function formatAmount(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `$${major.toFixed(2)}`;
  }
}

function resumeCheckoutUrl(args: {
  planSlug: string | null;
  volumeMessages: number | null;
  billingCycle: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.planSlug) params.set('plan', args.planSlug);
  if (args.volumeMessages) params.set('volume', String(args.volumeMessages));
  if (args.billingCycle) params.set('cycle', args.billingCycle);
  const q = params.toString();
  return q ? `${siteUrl()}/checkout?${q}` : `${siteUrl()}/checkout`;
}

export async function runCartRecovery(): Promise<{
  evaluated: number;
  sent: number;
  skipped: number;
  errors: number;
}> {
  const cfg = await getMarketingConfig();
  if (!cfg.cartEnabled) return { evaluated: 0, sent: 0, skipped: 0, errors: 0 };

  const reminders = await prisma.cartRecoveryReminder.findMany({
    where: { enabled: true },
    orderBy: { delayMinutes: 'asc' },
  });
  if (reminders.length === 0) return { evaluated: 0, sent: 0, skipped: 0, errors: 0 };

  const minDelay = Math.min(...reminders.map((r) => r.delayMinutes));
  const maxWindow = Math.max(...reminders.map((r) => r.delayMinutes)) + 24 * 60; // +1d grace
  const now = Date.now();
  const cutoff = new Date(now - minDelay * 60_000);
  const floor = new Date(now - maxWindow * 60_000);

  // Open carts = CheckoutOrder rows that never reached PAID, created
  // within the chase window.
  const carts = await prisma.checkoutOrder.findMany({
    where: {
      status: { in: ['DRAFT', 'PENDING', 'FAILED'] as never },
      paidAt: null,
      createdAt: { lte: cutoff, gte: floor },
    },
    select: {
      id: true,
      customerEmail: true,
      customerFirstName: true,
      planSlug: true,
      planName: true,
      volumeMessages: true,
      billingCycle: true,
      amountCents: true,
      currency: true,
      createdAt: true,
    },
    take: 500,
  });

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  // Dedup by email: if the email already has a PAID order (converted),
  // skip entirely.
  const emails = Array.from(new Set(carts.map((c) => c.customerEmail.toLowerCase())));
  const paidEmails = new Set(
    (
      await prisma.checkoutOrder.findMany({
        where: {
          customerEmail: { in: emails },
          status: 'PAID' as never,
        },
        select: { customerEmail: true },
      })
    ).map((o) => o.customerEmail.toLowerCase()),
  );

  for (const cart of carts) {
    if (paidEmails.has(cart.customerEmail.toLowerCase())) {
      skipped++;
      continue;
    }
    const ageMin = Math.floor((now - cart.createdAt.getTime()) / 60_000);
    const match = [...reminders].reverse().find((r) => r.delayMinutes <= ageMin);
    if (!match) {
      skipped++;
      continue;
    }

    const already = await prisma.cartRecoverySend.findUnique({
      where: {
        orderId_reminderId_anchorAt: {
          orderId: cart.id,
          reminderId: match.id,
          anchorAt: cart.createdAt,
        },
      },
    });
    if (already) {
      skipped++;
      continue;
    }

    const vars: Vars = {
      user_name: cart.customerFirstName || cart.customerEmail.split('@')[0] || 'there',
      plan_name: cart.planName,
      credits: String(cart.volumeMessages),
      amount: formatAmount(cart.amountCents, cart.currency),
      checkout_url: resumeCheckoutUrl({
        planSlug: cart.planSlug,
        volumeMessages: cart.volumeMessages,
        billingCycle: cart.billingCycle,
      }),
      whatsapp_url: cfg.whatsappUrl ?? '',
      site_name: SITE_NAME,
    };
    const { html, text } = renderEmail(match.bodyHtml, vars);
    const subject = interpolate(match.subject, vars);
    const result = await sendResend({
      to: cart.customerEmail,
      subject,
      html,
      text,
      bcc: match.bcc ?? cfg.defaultBcc,
    });
    try {
      await prisma.cartRecoverySend.create({
        data: {
          orderId: cart.id,
          reminderId: match.id,
          recipient: cart.customerEmail,
          anchorAt: cart.createdAt,
          status: result.error ? 'failed' : 'sent',
          resendId: result.id,
          error: result.error ?? null,
        },
      });
      if (result.error) errors++;
      else sent++;
    } catch {
      skipped++;
    }
  }

  return { evaluated: carts.length, sent, skipped, errors };
}

// ──────────────────────────────────────────────────────────────
// Overview (admin stats)
// ──────────────────────────────────────────────────────────────

export async function getMarketingOverview(): Promise<{
  config: Awaited<ReturnType<typeof getMarketingConfig>>;
  retarget: {
    reminderCount: number;
    sends30d: number;
    recentSends: Array<{
      id: string;
      recipient: string;
      reminderName: string;
      status: string;
      createdAt: Date;
    }>;
    dormantUsers: number;
  };
  cart: {
    reminderCount: number;
    sends30d: number;
    openCarts: number;
    recoveredRevenueCents: number;
    recentSends: Array<{
      id: string;
      recipient: string;
      reminderName: string;
      status: string;
      createdAt: Date;
    }>;
  };
  resendConfigured: boolean;
  cronSecretConfigured: boolean;
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);

  const [
    config,
    rtReminderCount,
    rtSends30d,
    rtRecent,
    dormantUsers,
    crReminderCount,
    crSends30d,
    openCarts,
    recoveredRevenue,
    crRecent,
    creds,
  ] = await Promise.all([
    getMarketingConfig(),
    prisma.retargetReminder.count(),
    prisma.retargetSend.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.retargetSend.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { reminder: { select: { name: true } } },
    }),
    prisma.user.count({ where: { lastSeenAt: { lte: sevenDaysAgo, not: null } } }),
    prisma.cartRecoveryReminder.count(),
    prisma.cartRecoverySend.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.checkoutOrder.count({
      where: { status: { in: ['DRAFT', 'PENDING', 'FAILED'] as never }, paidAt: null },
    }),
    prisma.checkoutOrder.aggregate({
      where: { status: 'PAID' as never, paidAt: { gte: thirtyDaysAgo } },
      _sum: { amountCents: true },
    }),
    prisma.cartRecoverySend.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { reminder: { select: { name: true } } },
    }),
    getResendCredentials(),
  ]);

  return {
    config,
    retarget: {
      reminderCount: rtReminderCount,
      sends30d: rtSends30d,
      recentSends: rtRecent.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        reminderName: r.reminder.name,
        status: r.status,
        createdAt: r.createdAt,
      })),
      dormantUsers,
    },
    cart: {
      reminderCount: crReminderCount,
      sends30d: crSends30d,
      openCarts,
      recoveredRevenueCents: recoveredRevenue._sum.amountCents ?? 0,
      recentSends: crRecent.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        reminderName: r.reminder.name,
        status: r.status,
        createdAt: r.createdAt,
      })),
    },
    resendConfigured: Boolean(creds.apiKey && creds.defaultFromEmail),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
  };
}
