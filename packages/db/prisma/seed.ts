/* eslint-disable no-console */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ContactEventType,
  ContactSource,
  CustomFieldType,
  PrismaClient,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const INVITE_EXPIRY_DAYS = 7;
const TRIAL_DAYS = 14;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Deterministic pick from an array given a 0-based index — keeps the demo
 *  data stable across re-runs without reaching for a PRNG. */
function pick<T>(items: readonly T[], i: number): T {
  const item = items[i % items.length];
  if (item === undefined) throw new Error('pick: empty items');
  return item;
}

async function main(): Promise<void> {
  console.info('[seed] starting…');

  // The seed bypasses RLS deliberately: it connects as the DB owner and does
  // not set `app.current_tenant_id`. That is intentional for a setup script;
  // application code must always go through `withTenant(...)`.

  // --------------------------------------------------------------------------
  // Phase 1: owner, tenant, membership, pending invites
  // --------------------------------------------------------------------------
  const owner = await prisma.user.upsert({
    where: { email: 'demo@getyn.app' },
    update: {},
    create: {
      email: 'demo@getyn.app',
      name: 'Demo Owner',
      supabaseUserId: `seed-${randomUUID()}`,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      slug: 'acme',
      name: 'Acme Inc',
      trialEndsAt: daysFromNow(TRIAL_DAYS),
    },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
    update: { role: Role.OWNER },
    create: { userId: owner.id, tenantId: tenant.id, role: Role.OWNER },
  });

  const pendingEmails = [
    { email: 'teammate1@example.com', role: Role.EDITOR },
    { email: 'teammate2@example.com', role: Role.VIEWER },
  ];

  const invites = [];
  for (const { email, role } of pendingEmails) {
    const existing = await prisma.invitation.findFirst({
      where: { tenantId: tenant.id, email, acceptedAt: null },
    });
    if (existing) {
      invites.push(existing);
      continue;
    }
    invites.push(
      await prisma.invitation.create({
        data: {
          tenantId: tenant.id,
          email,
          role,
          token: generateInviteToken(),
          invitedByUserId: owner.id,
          expiresAt: daysFromNow(INVITE_EXPIRY_DAYS),
        },
      }),
    );
  }

  // --------------------------------------------------------------------------
  // Phase 2: tags, custom fields, contacts, segments, events
  // --------------------------------------------------------------------------

  // Tags — 5 total, mix of colors from the preset palette
  const tagDefs = [
    { name: 'VIP', color: '#EF4444' },
    { name: 'Newsletter', color: '#3B82F6' },
    { name: 'Beta users', color: '#10B981' },
    { name: 'High intent', color: '#F59E0B' },
    { name: 'Cold', color: '#6B7280' },
  ];
  const tags = await Promise.all(
    tagDefs.map((t) =>
      prisma.tag.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: t.name } },
        update: { color: t.color },
        create: { tenantId: tenant.id, name: t.name, color: t.color },
      }),
    ),
  );

  // Custom fields — 2 definitions (plan_tier: SELECT, lifetime_value: NUMBER)
  const customFieldDefs = [
    {
      key: 'plan_tier',
      label: 'Plan tier',
      type: CustomFieldType.SELECT,
      options: { choices: ['free', 'starter', 'growth', 'pro'] },
    },
    {
      key: 'lifetime_value',
      label: 'Lifetime value (USD)',
      type: CustomFieldType.NUMBER,
      options: null,
    },
  ];
  for (const f of customFieldDefs) {
    await prisma.customField.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: f.key } },
      update: { label: f.label, options: f.options ?? undefined },
      create: {
        tenantId: tenant.id,
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? undefined,
      },
    });
  }

  // Contacts — 50 demo rows. Idempotent: skip if the count already >= 50 to
  // avoid compounding on repeated seed runs. If you genuinely want to reset,
  // delete the tenant and reseed.
  const existingContactCount = await prisma.contact.count({ where: { tenantId: tenant.id } });
  if (existingContactCount < 50) {
    const firstNames = [
      'Amelia', 'Liam', 'Sofia', 'Noah', 'Aria', 'Ethan', 'Maya', 'Kai', 'Zara', 'Milo',
      'Nora', 'Leo', 'Isla', 'Arjun', 'Priya', 'Ravi', 'Ananya', 'Devansh', 'Tara', 'Vikram',
    ];
    const lastNames = [
      'Singh', 'Patel', 'Kumar', 'Shah', 'Gupta', 'Rao', 'Iyer', 'Mehta', 'Chen', 'Wong',
      'Garcia', 'Rodriguez', 'Silva', 'Okafor', 'Ali',
    ];
    const statuses = [
      SubscriptionStatus.SUBSCRIBED,
      SubscriptionStatus.SUBSCRIBED,
      SubscriptionStatus.SUBSCRIBED,
      SubscriptionStatus.SUBSCRIBED,
      SubscriptionStatus.UNSUBSCRIBED,
      SubscriptionStatus.BOUNCED,
    ];
    const sources = [
      ContactSource.MANUAL,
      ContactSource.IMPORT,
      ContactSource.IMPORT,
      ContactSource.FORM,
      ContactSource.API,
    ];
    const languages = ['en', 'en-US', 'en-GB', 'es', 'fr', 'hi'];
    const timezones = [
      'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Singapore', null,
    ];

    for (let i = 0; i < 50; i++) {
      const first = pick(firstNames, i);
      const last = pick(lastNames, i * 3);
      const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`;
      const createdAt = daysAgo(60 - i); // spread over ~2 months, newest last
      await prisma.contact.upsert({
        where: {
          // Use the partial unique index via upsert's fallback where clause.
          // Prisma can't target partial uniques, so we match on (email) alone
          // and filter by tenantId in create conditions — good enough for seed.
          id: `seed-contact-${tenant.id}-${i}`,
        },
        update: {},
        create: {
          id: `seed-contact-${tenant.id}-${i}`,
          tenantId: tenant.id,
          email,
          phone: i % 3 === 0 ? `+1555010${String(1000 + i).padStart(4, '0')}` : null,
          firstName: first,
          lastName: last,
          emailStatus: pick(statuses, i),
          smsStatus: pick(statuses, i + 2),
          whatsappStatus: pick(statuses, i + 4),
          source: pick(sources, i),
          language: pick(languages, i),
          timezone: pick(timezones, i),
          customFields: {
            plan_tier: pick(['free', 'starter', 'growth', 'pro'], i),
            lifetime_value: (i * 37) % 500,
          },
          createdAt,
          updatedAt: createdAt,
        },
      });
    }
  }

  const contacts = await prisma.contact.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, emailStatus: true, source: true, createdAt: true },
  });

  // ContactTag — distribute tags across the first ~30 contacts
  for (let i = 0; i < Math.min(contacts.length, 30); i++) {
    const contact = contacts[i];
    if (!contact) continue;
    const tag = pick(tags, i);
    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId: contact.id, tagId: tag.id } },
      update: {},
      create: { contactId: contact.id, tagId: tag.id },
    });
    // Some contacts get a second tag
    if (i % 4 === 0) {
      const tag2 = pick(tags, i + 2);
      if (tag2.id !== tag.id) {
        await prisma.contactTag.upsert({
          where: { contactId_tagId: { contactId: contact.id, tagId: tag2.id } },
          update: {},
          create: { contactId: contact.id, tagId: tag2.id },
        });
      }
    }
  }

  // Segments — 2 simple ones. Rules are validated by the app's
  // segmentRulesSchema before writes in production; here we inline the
  // already-valid shape.
  const vipTagId = tags.find((t) => t.name === 'VIP')?.id;
  await prisma.segment.upsert({
    where: { id: `seed-segment-${tenant.id}-active-vips` },
    update: {},
    create: {
      id: `seed-segment-${tenant.id}-active-vips`,
      tenantId: tenant.id,
      name: 'Active VIPs',
      description: 'Subscribed, tagged VIP',
      rules: {
        kind: 'group',
        operator: 'AND',
        children: [
          { kind: 'condition', field: 'email_status', operator: 'equals', value: 'SUBSCRIBED' },
          { kind: 'condition', field: 'tag', operator: 'equals', value: vipTagId ?? '' },
        ],
      },
      createdByUserId: owner.id,
    },
  });

  await prisma.segment.upsert({
    where: { id: `seed-segment-${tenant.id}-recent-signups` },
    update: {},
    create: {
      id: `seed-segment-${tenant.id}-recent-signups`,
      tenantId: tenant.id,
      name: 'Recent signups',
      description: 'Created in the last 14 days',
      rules: {
        kind: 'group',
        operator: 'AND',
        children: [
          { kind: 'condition', field: 'created_at', operator: 'within_last_days', value: 14 },
        ],
      },
      createdByUserId: owner.id,
    },
  });

  // ContactEvents — plausible backfill so the timeline isn't empty in dev.
  // Idempotent: only seed events if there are fewer than 150 for this tenant.
  const existingEvents = await prisma.contactEvent.count({ where: { tenantId: tenant.id } });
  if (existingEvents < 150) {
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (!contact) continue;
      // Every contact has a CREATED event on its creation day
      await prisma.contactEvent.create({
        data: {
          tenantId: tenant.id,
          contactId: contact.id,
          type: ContactEventType.CREATED,
          metadata: { source: contact.source },
          occurredAt: contact.createdAt,
        },
      });
      // First 30 got a TAG_ADDED event near their create date
      if (i < 30) {
        await prisma.contactEvent.create({
          data: {
            tenantId: tenant.id,
            contactId: contact.id,
            type: ContactEventType.TAG_ADDED,
            metadata: { tagName: pick(tagDefs, i).name },
            occurredAt: new Date(contact.createdAt.getTime() + 60_000),
          },
        });
      }
      // The unsubscribed ones got an UNSUBSCRIBED event 2 weeks after creation
      if (contact.emailStatus === SubscriptionStatus.UNSUBSCRIBED) {
        await prisma.contactEvent.create({
          data: {
            tenantId: tenant.id,
            contactId: contact.id,
            type: ContactEventType.UNSUBSCRIBED,
            metadata: { channel: 'EMAIL', reason: 'user_action' },
            occurredAt: new Date(contact.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000),
          },
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Report
  // --------------------------------------------------------------------------
  const counts = {
    contacts: await prisma.contact.count({ where: { tenantId: tenant.id } }),
    tags: await prisma.tag.count({ where: { tenantId: tenant.id } }),
    customFields: await prisma.customField.count({ where: { tenantId: tenant.id } }),
    segments: await prisma.segment.count({ where: { tenantId: tenant.id } }),
    events: await prisma.contactEvent.count({ where: { tenantId: tenant.id } }),
  };

  console.info('[seed] ✅ demo workspace ready');
  console.info(`        tenant:   ${tenant.name} (/t/${tenant.slug})`);
  console.info(`        owner:    ${owner.email}`);
  console.info('        pending invitations:');
  for (const inv of invites) {
    console.info(`          - ${inv.email} (${inv.role})`);
    console.info(`            ${APP_URL}/invite/${inv.token}`);
  }
  console.info('        phase 2 data:');
  console.info(`          contacts:      ${counts.contacts}`);
  console.info(`          tags:          ${counts.tags}`);
  console.info(`          custom fields: ${counts.customFields}`);
  console.info(`          segments:      ${counts.segments}`);
  console.info(`          events:        ${counts.events}`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
