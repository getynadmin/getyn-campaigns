/* eslint-disable no-console */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AbVariant,
  CampaignEventType,
  CampaignSendStatus,
  CampaignStatus,
  ContactEventType,
  ContactSource,
  CustomFieldType,
  EmailTemplateCategory,
  PrismaClient,
  Role,
  SendingDomainStatus,
  SubscriptionStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';

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
  // Phase 3: system email templates (tenantId = null), verified sending domain,
  // 2 sample sent campaigns with realistic event data so analytics screens
  // have something to render.
  //
  // The Unlayer design JSON used here is intentionally minimal — enough to
  // round-trip through the editor without errors. Phase 3 M4 replaces these
  // with hand-designed templates that look genuinely good.
  // --------------------------------------------------------------------------

  const minimalDesign = (heading: string, body: string): Prisma.InputJsonValue => ({
    counters: { u_row: 1, u_column: 1, u_content_text: 2 },
    body: {
      rows: [
        {
          id: 'row-1',
          cells: [1],
          columns: [
            {
              id: 'col-1',
              contents: [
                {
                  id: 'text-heading',
                  type: 'text',
                  values: { text: `<h1 style="text-align:center">${heading}</h1>` },
                },
                {
                  id: 'text-body',
                  type: 'text',
                  values: { text: `<p>${body}</p>` },
                },
              ],
              values: {},
            },
          ],
          values: { backgroundColor: '#ffffff' },
        },
      ],
      values: { backgroundColor: '#f4f4f7', contentWidth: '600px' },
    },
    schemaVersion: 12,
  });

  const systemTemplates = [
    {
      name: 'Welcome',
      description: 'Greet new contacts the moment they sign up.',
      category: EmailTemplateCategory.WELCOME,
      heading: 'Welcome to {{companyName}} 👋',
      body: 'We\'re glad you\'re here. Here\'s what to expect from us next.',
    },
    {
      name: 'Newsletter',
      description: 'Monthly digest of product updates + community wins.',
      category: EmailTemplateCategory.NEWSLETTER,
      heading: 'This month at {{companyName}}',
      body: 'Three things worth your time. Skim or click through.',
    },
    {
      name: 'Promotional offer',
      description: 'Limited-time discount with a clear call to action.',
      category: EmailTemplateCategory.PROMOTIONAL,
      heading: 'A little something for you, {{firstName}}',
      body: 'Use code SAVE20 for 20% off through Sunday.',
    },
    {
      name: 'Product announcement',
      description: 'Introduce a new feature or release.',
      category: EmailTemplateCategory.ANNOUNCEMENT,
      heading: 'Introducing — something new',
      body: 'We just shipped a thing we think you\'ll love. Here\'s what it does.',
    },
    {
      name: 'Event invite',
      description: 'Webinar / launch event RSVP request.',
      category: EmailTemplateCategory.EVENT,
      heading: 'You\'re invited',
      body: 'Join us on date X for event Y. RSVP below.',
    },
    {
      name: 'Re-engagement',
      description: 'Win back contacts who haven\'t engaged in a while.',
      category: EmailTemplateCategory.OTHER,
      heading: 'We\'ve missed you',
      body: 'Here\'s what\'s new since we last spoke.',
    },
    {
      name: 'Product launch',
      description: 'Big-bang announcement for a major release.',
      category: EmailTemplateCategory.ANNOUNCEMENT,
      heading: 'It\'s here.',
      body: 'After months of work — this is what we built. Take a look.',
    },
    {
      name: 'Transactional receipt',
      description: 'Order confirmation / receipt template.',
      category: EmailTemplateCategory.TRANSACTIONAL,
      heading: 'Your receipt — order #{{orderId}}',
      body: 'Thanks for your purchase. Details below.',
    },
  ] as const;

  const seededTemplates = [];
  for (const tpl of systemTemplates) {
    // Use a stable id pattern so re-running the seed doesn't duplicate.
    const id = `seed-tpl-${tpl.name.toLowerCase().replace(/\W+/g, '-')}`;
    const upserted = await prisma.emailTemplate.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId: null, // system template — visible to every tenant
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        designJson: minimalDesign(tpl.heading, tpl.body),
      },
    });
    seededTemplates.push(upserted);
  }

  // Verified sending domain for the demo tenant — gives the campaign wizard
  // something to pre-select. Phase 3 M2 wires real Resend domain creation.
  const sendingDomain = await prisma.sendingDomain.upsert({
    where: { tenantId_domain: { tenantId: tenant.id, domain: 'mail.acme.dev' } },
    update: {},
    create: {
      tenantId: tenant.id,
      domain: 'mail.acme.dev',
      resendDomainId: 'seed-resend-domain-acme',
      status: SendingDomainStatus.VERIFIED,
      verifiedAt: daysAgo(30),
      dnsRecords: [
        {
          type: 'TXT',
          name: 'mail.acme.dev',
          value: 'v=spf1 include:resend.dev ~all',
          status: 'verified',
        },
        {
          type: 'TXT',
          name: 'resend._domainkey.mail.acme.dev',
          value: 'v=DKIM1; k=rsa; p=MIGfMA0G... (truncated)',
          status: 'verified',
        },
        {
          type: 'TXT',
          name: '_dmarc.mail.acme.dev',
          value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.dev',
          status: 'verified',
        },
        {
          type: 'MX',
          name: 'mail.acme.dev',
          value: 'feedback-smtp.us-east-1.amazonses.com',
          priority: 10,
          status: 'verified',
        },
      ],
      lastCheckedAt: new Date(),
    },
  });

  // Two sample campaigns — needs the seeded segments to exist already.
  const segments = await prisma.segment.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });

  const sampleCampaigns = [
    {
      name: 'Spring newsletter (sent)',
      sentDaysAgo: 7,
      sendCount: 30,
      openRate: 0.4, // 12 opens
      clickRate: 0.13, // 4 clicks (subset of opens)
      bouncesCount: 1,
      complaintsCount: 0,
      segment: segments[0],
      template: seededTemplates[1], // Newsletter
    },
    {
      name: 'Welcome series #1 (sent)',
      sentDaysAgo: 3,
      sendCount: 20,
      openRate: 0.65, // 13 opens
      clickRate: 0.25, // 5 clicks
      bouncesCount: 0,
      complaintsCount: 0,
      segment: segments[1] ?? segments[0],
      template: seededTemplates[0], // Welcome
    },
  ];

  const seededContacts = await prisma.contact.findMany({
    where: { tenantId: tenant.id, deletedAt: null, email: { not: null } },
    take: 30,
    orderBy: { createdAt: 'asc' },
  });

  for (const cfg of sampleCampaigns) {
    if (!cfg.segment) continue;
    const id = `seed-camp-${cfg.name.toLowerCase().replace(/\W+/g, '-')}`;
    const sentAt = daysAgo(cfg.sentDaysAgo);

    const campaign = await prisma.campaign.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId: tenant.id,
        type: 'EMAIL',
        name: cfg.name,
        status: CampaignStatus.SENT,
        segmentId: cfg.segment.id,
        sentAt,
        timezone: 'UTC',
        createdByUserId: owner.id,
      },
    });

    // EmailCampaign sidecar — once campaign exists.
    await prisma.emailCampaign.upsert({
      where: { campaignId: campaign.id },
      update: {},
      create: {
        campaignId: campaign.id,
        subject: cfg.name.replace(' (sent)', ''),
        previewText: 'A short preview...',
        fromName: 'Acme Inc',
        fromEmail: 'team@mail.acme.dev',
        sendingDomainId: sendingDomain.id,
        designJson: (cfg.template?.designJson ?? minimalDesign(cfg.name, '')) as Prisma.InputJsonValue,
        renderedHtml:
          `<html><body><h1>${cfg.name}</h1><p>This is a seeded sample.</p></body></html>`,
        renderedText: `${cfg.name}\n\nThis is a seeded sample.`,
        templateId: cfg.template?.id ?? null,
      },
    });

    // CampaignSends + CampaignEvents — one row per recipient sampled from
    // the seeded contacts. Idempotent via deterministic ids.
    const recipients = seededContacts.slice(0, cfg.sendCount);
    const opens = Math.round(cfg.sendCount * cfg.openRate);
    const clicks = Math.round(cfg.sendCount * cfg.clickRate);

    for (let i = 0; i < recipients.length; i++) {
      const contact = recipients[i];
      if (!contact?.email) continue;
      const sendId = `seed-send-${id}-${i}`;
      const isBounced = i < cfg.bouncesCount;
      const isOpened = !isBounced && i < cfg.bouncesCount + opens;
      const isClicked = isOpened && i < cfg.bouncesCount + clicks;

      const status: CampaignSendStatus = isBounced
        ? CampaignSendStatus.BOUNCED
        : isClicked
          ? CampaignSendStatus.CLICKED
          : isOpened
            ? CampaignSendStatus.OPENED
            : CampaignSendStatus.DELIVERED;

      await prisma.campaignSend.upsert({
        where: { id: sendId },
        update: {},
        create: {
          id: sendId,
          tenantId: tenant.id,
          campaignId: campaign.id,
          contactId: contact.id,
          email: contact.email,
          messageId: `seed-msg-${id}-${i}`,
          status,
          sentAt,
          lastEventAt: sentAt,
        },
      });

      // Always SENT + DELIVERED events
      await prisma.campaignEvent.upsert({
        where: { id: `${sendId}-evt-sent` },
        update: {},
        create: {
          id: `${sendId}-evt-sent`,
          tenantId: tenant.id,
          campaignSendId: sendId,
          campaignId: campaign.id,
          type: CampaignEventType.SENT,
          occurredAt: sentAt,
        },
      });
      if (!isBounced) {
        await prisma.campaignEvent.upsert({
          where: { id: `${sendId}-evt-delivered` },
          update: {},
          create: {
            id: `${sendId}-evt-delivered`,
            tenantId: tenant.id,
            campaignSendId: sendId,
            campaignId: campaign.id,
            type: CampaignEventType.DELIVERED,
            occurredAt: new Date(sentAt.getTime() + 5 * 60_000),
          },
        });
      }
      if (isOpened) {
        await prisma.campaignEvent.upsert({
          where: { id: `${sendId}-evt-opened` },
          update: {},
          create: {
            id: `${sendId}-evt-opened`,
            tenantId: tenant.id,
            campaignSendId: sendId,
            campaignId: campaign.id,
            type: CampaignEventType.OPENED,
            metadata: { userAgent: 'Mozilla/5.0 seed' },
            occurredAt: new Date(sentAt.getTime() + 30 * 60_000),
          },
        });
      }
      if (isClicked) {
        await prisma.campaignEvent.upsert({
          where: { id: `${sendId}-evt-clicked` },
          update: {},
          create: {
            id: `${sendId}-evt-clicked`,
            tenantId: tenant.id,
            campaignSendId: sendId,
            campaignId: campaign.id,
            type: CampaignEventType.CLICKED,
            metadata: { url: 'https://example.com/landing', userAgent: 'Mozilla/5.0 seed' },
            occurredAt: new Date(sentAt.getTime() + 45 * 60_000),
          },
        });
      }
      if (isBounced) {
        await prisma.campaignEvent.upsert({
          where: { id: `${sendId}-evt-bounced` },
          update: {},
          create: {
            id: `${sendId}-evt-bounced`,
            tenantId: tenant.id,
            campaignSendId: sendId,
            campaignId: campaign.id,
            type: CampaignEventType.BOUNCED,
            metadata: {
              bounceCode: '5.1.1',
              bounceReason: 'Recipient address rejected',
              recipient: contact.email,
            },
            occurredAt: new Date(sentAt.getTime() + 2 * 60_000),
          },
        });
      }
    }
  }

  // Suppress AbVariant unused-import warning when we don't actually create A/B
  // campaigns in the seed yet — the import is kept for forward compatibility
  // when the seed grows to include A/B examples.
  void AbVariant;

  // --------------------------------------------------------------------------
  // Report
  // --------------------------------------------------------------------------
  const counts = {
    contacts: await prisma.contact.count({ where: { tenantId: tenant.id } }),
    tags: await prisma.tag.count({ where: { tenantId: tenant.id } }),
    customFields: await prisma.customField.count({ where: { tenantId: tenant.id } }),
    segments: await prisma.segment.count({ where: { tenantId: tenant.id } }),
    events: await prisma.contactEvent.count({ where: { tenantId: tenant.id } }),
    systemTemplates: await prisma.emailTemplate.count({ where: { tenantId: null } }),
    sendingDomains: await prisma.sendingDomain.count({ where: { tenantId: tenant.id } }),
    campaigns: await prisma.campaign.count({ where: { tenantId: tenant.id } }),
    campaignSends: await prisma.campaignSend.count({ where: { tenantId: tenant.id } }),
    campaignEvents: await prisma.campaignEvent.count({ where: { tenantId: tenant.id } }),
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
  console.info('        phase 3 data:');
  console.info(`          system templates:  ${counts.systemTemplates}`);
  console.info(`          sending domains:   ${counts.sendingDomains}`);
  console.info(`          campaigns (sent):  ${counts.campaigns}`);
  console.info(`          campaign sends:    ${counts.campaignSends}`);
  console.info(`          campaign events:   ${counts.campaignEvents}`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
