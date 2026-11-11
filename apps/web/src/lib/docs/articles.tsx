/**
 * Docs content — categories + articles for /docs.
 *
 * Stored as plain data + JSX blocks so we get type safety, easy
 * editing, and zero runtime overhead (no MDX runtime). Each article
 * exports a slug, title, summary, and a React node for the body.
 *
 * Adding an article: drop a new entry under the relevant category's
 * `articles` array. Slugs must be unique within a category.
 */
import type { ReactNode } from 'react';

import { slugifyHeading } from './headings';

export interface Article {
  slug: string;
  title: string;
  summary: string;
  /** Estimated reading time, in whole minutes. */
  minutes: number;
  body: ReactNode;
}

export interface Category {
  slug: string;
  title: string;
  description: string;
  /** Optional emoji-style icon shown on the index card. */
  icon: string;
  articles: Article[];
}

// ---------------------------------------------------------------------------
// Shared building blocks for article bodies. Kept JSX-as-data so this whole
// file remains a pure data module without per-article JSX gymnastics.
// ---------------------------------------------------------------------------

const P = (children: ReactNode) => (
  <p className="leading-relaxed text-foreground/90">{children}</p>
);

const H2 = (text: string) => (
  <h2
    id={slugifyHeading(text)}
    className="mt-10 scroll-mt-24 font-display text-xl font-semibold tracking-tight"
  >
    {text}
  </h2>
);

const UL = (items: ReactNode[]) => (
  <ul className="ml-5 list-disc space-y-1.5 text-foreground/90 marker:text-foreground/40">
    {items.map((item, i) => (
      <li key={i} className="leading-relaxed">
        {item}
      </li>
    ))}
  </ul>
);

const OL = (items: ReactNode[]) => (
  <ol className="ml-5 list-decimal space-y-1.5 text-foreground/90 marker:text-foreground/40">
    {items.map((item, i) => (
      <li key={i} className="leading-relaxed">
        {item}
      </li>
    ))}
  </ol>
);

const Tip = (children: ReactNode) => (
  <div className="my-4 rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
    <strong className="mr-1">Tip.</strong>
    {children}
  </div>
);

const Warn = (children: ReactNode) => (
  <div className="my-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
    <strong className="mr-1">Heads up.</strong>
    {children}
  </div>
);

const Code = (text: string) => (
  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
    {text}
  </code>
);

/**
 * Related-articles block used at the bottom of every new article.
 * Each entry is `[categorySlug, articleSlug, label]` — rendered as a
 * tidy link row with a subtle surface so it reads as its own section.
 */
const Related = (
  items: Array<readonly [string, string, string]>,
) => (
  <div className="mt-10 rounded-xl border bg-muted/30 p-4">
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-500 dark:text-orange-400">
      Related articles
    </p>
    <ul className="space-y-1.5 text-sm">
      {items.map(([cat, slug, label]) => (
        <li key={`${cat}/${slug}`}>
          <a
            href={`/docs/${cat}/${slug}`}
            className="inline-flex items-center gap-1.5 font-medium text-foreground/80 hover:text-foreground hover:underline"
          >
            {label}
            <span aria-hidden>→</span>
          </a>
        </li>
      ))}
    </ul>
  </div>
);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const categories: Category[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description:
      'Set up your Getyn Campaigns workspace and get your first campaign in the air.',
    icon: '🚀',
    articles: [
      {
        slug: 'create-your-workspace',
        title: 'Sign up and create your workspace',
        summary:
          'Make an account, choose a workspace slug, and invite your team.',
        minutes: 3,
        body: (
          <>
            {P(
              'A workspace is the home for your brand inside Getyn Campaigns — every contact, campaign, segment, and integration is scoped to one. Most companies need just one workspace; multi-brand teams may want one per brand.',
            )}
            {H2('Sign up')}
            {OL([
              <>
                Go to <strong>campaigns.getyn.com/signup</strong> and enter
                your work email.
              </>,
              <>
                Confirm the verification email (check spam if it doesn’t
                arrive within a minute).
              </>,
              <>
                Pick a workspace name (e.g. <em>Acme Marketing</em>) and a
                slug (the URL fragment, e.g. {Code('acme')}).
              </>,
            ])}
            {Tip(
              <>
                The slug becomes part of every internal URL ({Code('/t/acme')}).
                Keep it short, lowercase, hyphens only. You can rename it
                later in <strong>Settings → Workspace</strong>.
              </>,
            )}
            {H2('Invite teammates')}
            {P(
              'Go to Settings → Team. Add teammates by email and assign a role:',
            )}
            {UL([
              <>
                <strong>Owner</strong> — full control, billing, deletion.
              </>,
              <>
                <strong>Admin</strong> — manage settings, integrations,
                team.
              </>,
              <>
                <strong>Editor</strong> — create campaigns, edit contacts.
              </>,
              <>
                <strong>Viewer</strong> — read-only access.
              </>,
            ])}
            {H2('Next steps')}
            {UL([
              <>Set your brand profile so the AI agent has context.</>,
              <>Verify your sending domain for better inboxing.</>,
              <>Import your contacts via CSV.</>,
            ])}
          </>
        ),
      },
      {
        slug: 'add-your-first-contact',
        title: 'Add your first contact',
        summary:
          'Create a single contact manually to test campaigns before bulk import.',
        minutes: 2,
        body: (
          <>
            {P(
              'Adding one contact by hand is the fastest way to get something testable in your workspace. Use it to send yourself a test campaign before you import thousands of leads.',
            )}
            {H2('Steps')}
            {OL([
              <>
                Go to <strong>Audience → Contacts</strong>.
              </>,
              <>
                Click <strong>+ New contact</strong> in the top right.
              </>,
              <>
                Fill in at least an email or phone number. First name +
                last name are optional but help personalisation.
              </>,
              <>
                Pick the channel statuses — <strong>SUBSCRIBED</strong>{' '}
                means the contact has opted in.
              </>,
              <>Click Save.</>,
            ])}
            {Warn(
              <>
                Don’t mark contacts as <strong>SUBSCRIBED</strong> unless
                they really opted in. Spam complaints from imported but
                non-consenting recipients hurt your domain reputation —
                use <strong>PENDING</strong> for unsure cases and re-confirm
                via a double opt-in flow.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'verify-sending-domain',
        title: 'Verify your sending domain',
        summary:
          'Set up SPF, DKIM, and MX records so campaigns come from your domain.',
        minutes: 5,
        body: (
          <>
            {P(
              'Without a verified domain, campaigns send from a shared @getynmail.com address — fine for getting started but inboxing is meaningfully worse than from your own brand. Verifying takes ~5 minutes plus DNS propagation.',
            )}
            {H2('Add the domain in Getyn')}
            {OL([
              <>
                Go to <strong>Settings → Sending domains</strong>.
              </>,
              <>
                Click <strong>+ Add domain</strong>, enter the domain (e.g.{' '}
                {Code('mail.yourbrand.com')}).
              </>,
              <>Getyn shows three DNS records — TXT (DKIM), MX, and TXT (SPF).</>,
            ])}
            {H2('Update DNS at your registrar')}
            {P(
              'Copy each record into your DNS provider (GoDaddy, Cloudflare, Namecheap, Route53, etc.). The hostnames are subdomain-relative — your provider may auto-suffix the root domain.',
            )}
            {Tip(
              <>
                Cloudflare proxies CNAME records by default. For email
                records make sure the cloud icon is <strong>grey (DNS only)</strong>,
                not orange.
              </>,
            )}
            {H2('Verify')}
            {OL([
              <>
                Back in Getyn, click <strong>Check status</strong> on the
                domain card.
              </>,
              <>Each record shows verified individually as DNS propagates.</>,
              <>
                The whole domain flips to <strong>Verified</strong> when all
                three pass — usually within 5 minutes, occasionally up to
                48 hours.
              </>,
            ])}
            {Warn(
              <>
                Until the domain is verified, campaigns still send from
                the shared pool. Don’t schedule large sends before
                verification — the from-address will surprise recipients.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'connect-whatsapp',
        title: 'Connect WhatsApp Business',
        summary:
          'Link your Meta WhatsApp Business Account so you can send WhatsApp campaigns.',
        minutes: 6,
        body: (
          <>
            {P(
              'Getyn Campaigns sends WhatsApp via the official Meta WhatsApp Business API. You need a Meta Business Account, a verified business, and at least one approved phone number.',
            )}
            {H2('Prerequisites')}
            {UL([
              <>
                A <strong>Meta Business Account</strong> (free, signup at
                business.facebook.com).
              </>,
              <>
                Business verification with Meta — usually 1–3 days,
                requires registered business documents.
              </>,
              <>A phone number not currently registered on regular WhatsApp.</>,
            ])}
            {H2('Connect in Getyn')}
            {OL([
              <>
                Go to <strong>Settings → Channels → WhatsApp</strong>.
              </>,
              <>
                Click <strong>Connect WhatsApp Business</strong> — opens
                Meta’s embedded signup flow.
              </>,
              <>
                Pick the WhatsApp Business Account and phone numbers to
                connect.
              </>,
              <>Authorize Getyn to send on your behalf.</>,
              <>
                Set a display name for each phone number (shown to
                recipients).
              </>,
            ])}
            {H2('After connecting')}
            {P(
              'Your phone numbers appear in Channels. To send a marketing campaign you’ll first need an APPROVED template — see "WhatsApp template approval".',
            )}
          </>
        ),
      },
      {
        slug: 'set-brand-profile',
        title: 'Set your brand profile',
        summary:
          'Tell the AI agent about your brand voice, colors, and audience.',
        minutes: 4,
        body: (
          <>
            {P(
              'The AI Campaign Agent reads your brand profile on every conversation to draft on-brand campaigns. Fill it once at workspace setup — it dramatically improves first-draft quality.',
            )}
            {H2('Open the brand profile')}
            {P(
              <>
                Navigate to <strong>Settings → Brand</strong>.
              </>,
            )}
            {H2('What to fill in')}
            {UL([
              <>
                <strong>Brand name</strong> — the display name customers
                recognise (not your legal entity).
              </>,
              <>
                <strong>Description</strong> — 1–2 sentences. What do you
                sell, who do you sell it to?
              </>,
              <>
                <strong>Voice tone</strong> — pick one: Professional,
                Friendly, Casual, Playful, Authoritative, Empathetic.
              </>,
              <>
                <strong>Primary + accent colors</strong> — used by the
                email builder for CTAs and links.
              </>,
              <>
                <strong>Writing style</strong> — short prose like
                "Sentence case headings, no jargon, prefer active voice."
              </>,
              <>
                <strong>Dos and don’ts</strong> — anti-patterns the agent
                should avoid ("never use ‘limited time’ unless it really
                is").
              </>,
              <>
                <strong>Signature block</strong> — what to put at the
                bottom of emails.
              </>,
            ])}
            {Tip(
              <>
                Click <strong>Save & complete</strong> when done — the
                dashboard nudge clears and the AI Agent unlocks.
              </>,
            )}
          </>
        ),
      },
    ],
  },
  {
    slug: 'email-campaigns',
    title: 'Email campaigns',
    description:
      'Author, send, and analyze email campaigns with the drag-drop builder and AI agent.',
    icon: '✉️',
    articles: [
      {
        slug: 'create-first-campaign',
        title: 'Create your first email campaign',
        summary:
          'Pick an audience, write a subject, design the email, and ship it.',
        minutes: 5,
        body: (
          <>
            {P(
              'A campaign is one email going to one audience. You can craft it manually in the editor or through the AI agent — both finish in the same place: a DRAFT campaign you review and send.',
            )}
            {H2('Manual flow')}
            {OL([
              <>
                Go to <strong>Communicate → Campaigns</strong>.
              </>,
              <>
                Click <strong>New campaign → Email campaign</strong>.
              </>,
              <>Name the campaign + pick a segment.</>,
              <>
                Enter the subject line, preview text, and from-address.
              </>,
              <>
                Click <strong>Open editor</strong> — drag blocks, edit
                content.
              </>,
              <>
                Click <strong>Save design</strong>, then{' '}
                <strong>Send now</strong> or <strong>Schedule</strong>.
              </>,
            ])}
            {H2('AI agent flow')}
            {OL([
              <>
                On the campaigns page, click the <strong>Create with AI</strong>{' '}
                card and pick Email.
              </>,
              <>Chat with the agent — it asks the questions it needs.</>,
              <>
                Agent calls {Code('propose_design_plan')} assembling blocks
                from the vetted library.
              </>,
              <>
                Iterate in chat or click <strong>Open in editor</strong> to
                polish in the visual editor.
              </>,
              <>
                Agent calls {Code('finalize_draft')} — your campaign is
                ready to send.
              </>,
            ])}
            {Tip(
              <>
                The AI agent honours your brand profile. Fill that in
                first for best results.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'use-drag-drop-editor',
        title: 'Use the drag-and-drop editor',
        summary:
          'Blocks, rows, columns, merge tags, and saving designs in the visual editor.',
        minutes: 6,
        body: (
          <>
            {P(
              'The email editor (powered by Unlayer under the hood) lets you compose responsive HTML emails without writing any code. Designs save to the campaign automatically as you edit.',
            )}
            {H2('The canvas')}
            {UL([
              <>
                <strong>Rows</strong> contain one or more <strong>columns</strong>.
                Columns hold <strong>content blocks</strong> (text, image,
                button, divider, social, video).
              </>,
              <>
                Drag from the right panel into the canvas. Click any
                block to edit its content + style in the right panel.
              </>,
              <>
                Switch between desktop and mobile preview from the top
                bar.
              </>,
            ])}
            {H2('Merge tags')}
            {P('Personalise content per-recipient with merge tags:')}
            {UL([
              <>
                {Code('{{firstName}}')} — recipient’s first name (falls
                back to empty string).
              </>,
              <>{Code('{{lastName}}')} — last name.</>,
              <>{Code('{{email}}')} — recipient’s email.</>,
              <>
                {Code('{{unsubscribeUrl}}')} — required by CAN-SPAM,
                auto-injected if you forget.
              </>,
              <>{Code('{{webViewUrl}}')} — "view in browser" link.</>,
            ])}
            {H2('Buttons & links')}
            {P(
              'Every link is automatically rewritten through Getyn’s click-tracking redirector when the campaign sends — so you’ll see click analytics per URL. The recipient still lands on your real destination.',
            )}
            {H2('Saving')}
            {P(
              <>
                The editor auto-saves your design every few seconds. You
                can also press <strong>Save</strong> in the top bar at any
                time. Designs lock once the campaign moves out of DRAFT.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'schedule-a-send',
        title: 'Schedule a send',
        summary: 'Send now vs schedule for later — and what happens after.',
        minutes: 3,
        body: (
          <>
            {P(
              'Once your draft is ready, you have two send options. Both run the same pre-flight checks (verified domain, postal address, segment non-empty, content scan).',
            )}
            {H2('Send now')}
            {OL([
              <>
                On the campaign detail page, click <strong>Send now</strong>.
              </>,
              <>
                Confirm the recipient count. This is the last reversible
                step.
              </>,
              <>
                Campaign flips to <strong>SENDING</strong> — worker picks
                it up within seconds.
              </>,
              <>Status changes to SENT once every recipient is dispatched.</>,
            ])}
            {H2('Schedule for later')}
            {OL([
              <>
                Click <strong>Schedule</strong>.
              </>,
              <>
                Pick a date + time in your workspace timezone (set in
                Settings → Workspace).
              </>,
              <>
                Campaign flips to <strong>SCHEDULED</strong>. The worker
                fires it at the chosen time.
              </>,
              <>
                You can <strong>Cancel</strong> a SCHEDULED campaign up
                until 60 seconds before send.
              </>,
            ])}
            {Tip(
              <>
                Schedule major sends 1–2 hours before your audience’s
                peak inbox time, not at it — most marketing emails arrive
                in batches and yours gets buried.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'ab-test-subject',
        title: 'A/B test subject lines',
        summary:
          'Send to a test cohort, pick a winner by open rate, deliver to the rest.',
        minutes: 4,
        body: (
          <>
            {P(
              'A/B subject testing splits your audience into two variant cohorts (typically 10% each), waits a few hours, then sends the winning variant to the remaining 80%. Getyn handles the timing automatically.',
            )}
            {H2('Set up')}
            {OL([
              <>
                On the campaign’s detail page, toggle <strong>A/B test</strong>{' '}
                on.
              </>,
              <>
                Enter Variant A subject + Variant B subject. Preheaders
                can differ too.
              </>,
              <>
                Pick the <strong>test cohort size</strong> per variant
                (default 10%).
              </>,
              <>
                Pick the <strong>winner metric</strong> — open rate or
                click rate.
              </>,
              <>
                Pick the <strong>decision window</strong> — how long to
                wait before declaring a winner (default 2 hours).
              </>,
            ])}
            {H2('What happens after send')}
            {OL([
              <>Variant A goes to 10% randomly chosen recipients.</>,
              <>Variant B goes to another 10%.</>,
              <>
                After the decision window, Getyn picks the winner and
                ships it to the remaining 80%.
              </>,
              <>
                Both variants show in analytics with their cohort sizes
                and rates side-by-side.
              </>,
            ])}
            {Warn(
              <>
                Don’t A/B test on audiences smaller than ~2,000
                recipients — the cohorts get too small for the result to
                be statistically meaningful.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'read-analytics',
        title: 'Read campaign analytics',
        summary:
          'Opens, clicks, bounces, unsubscribes, and what to do with them.',
        minutes: 5,
        body: (
          <>
            {P(
              'Every campaign’s analytics tab shows real-time delivery + engagement metrics. Numbers update within seconds of each event.',
            )}
            {H2('Top-line metrics')}
            {UL([
              <>
                <strong>Delivered</strong> — recipient’s server accepted
                the message.
              </>,
              <>
                <strong>Opened</strong> — at least one of the recipient’s
                email clients loaded the tracking pixel. Apple Mail’s
                privacy protection auto-opens, inflating this number.
              </>,
              <>
                <strong>Clicked</strong> — at least one link in the email
                got clicked. More reliable than opens.
              </>,
              <>
                <strong>Bounced</strong> — message rejected (bad address,
                full inbox, content). Bounce rate &gt; 2% is concerning.
              </>,
              <>
                <strong>Unsubscribed</strong> — recipient clicked your
                unsubscribe link.
              </>,
              <>
                <strong>Spam complaints</strong> — recipient marked as
                spam. Keep this under 0.1%.
              </>,
            ])}
            {H2('Top links')}
            {P(
              'See which URLs in your email got the most clicks. Use this to learn what content your audience cares about.',
            )}
            {H2('Recipient drill-down')}
            {P(
              'The recipients tab lets you filter by event type (e.g. show me everyone who clicked link #3). Useful for follow-up segmentation.',
            )}
            {Tip(
              <>
                Treat opens with skepticism, clicks as truth, and
                conversions (your business metric) as the only one that
                actually matters.
              </>,
            )}
          </>
        ),
      },
    ],
  },
  {
    slug: 'contacts-and-segments',
    title: 'Contacts & segments',
    description:
      'Import contacts, organise with custom fields and tags, and build segments.',
    icon: '👥',
    articles: [
      {
        slug: 'import-contacts-csv',
        title: 'Import contacts from CSV',
        summary:
          'Upload a CSV, map columns, choose dedupe behavior, kick off the import.',
        minutes: 5,
        body: (
          <>
            {P(
              'The CSV import handles up to 100k contacts per file and runs in the background — you can navigate away while it processes.',
            )}
            {H2('Prepare your CSV')}
            {UL([
              <>
                First row is the header. Common columns: email, phone,
                first name, last name.
              </>,
              <>
                One contact per row. At least one of email or phone is
                required per row.
              </>,
              <>UTF-8 encoding. Save from Excel as "CSV UTF-8".</>,
              <>
                Quote any fields containing commas, newlines, or
                quotation marks.
              </>,
            ])}
            {H2('Run the import')}
            {OL([
              <>
                Go to <strong>Audience → Contacts → Import</strong>.
              </>,
              <>Upload the file. Getyn detects columns automatically.</>,
              <>
                Map each CSV column to a contact field or "Skip". Map
                unknowns to a custom field.
              </>,
              <>
                Pick the <strong>dedupe strategy</strong> — match existing
                contacts by email, phone, or either.
              </>,
              <>
                Pick default channel statuses. Use{' '}
                <strong>SUBSCRIBED</strong> only if the contacts truly
                opted in.
              </>,
              <>
                Optionally tag every imported row (e.g.{' '}
                <em>Q4 CRM Leads</em>).
              </>,
              <>
                Click <strong>Start import</strong>. Progress + errors
                surface live.
              </>,
            ])}
            {Warn(
              <>
                Mass-importing cold leads with SUBSCRIBED status is the
                fastest way to get your sending domain blacklisted.
                Always require explicit opt-in.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'custom-fields',
        title: 'Add custom fields',
        summary:
          'Store extra per-contact data and use it in merge tags + segments.',
        minutes: 3,
        body: (
          <>
            {P(
              'Custom fields hold per-contact data beyond the built-in fields (email, phone, name). Examples: subscription plan, last purchase date, lifetime value, account tier.',
            )}
            {H2('Create a custom field')}
            {OL([
              <>
                Go to <strong>Settings → Custom fields</strong>.
              </>,
              <>
                Click <strong>+ New field</strong>.
              </>,
              <>
                Pick a key (used in merge tags, e.g.{' '}
                {Code('subscription_plan')}) and label (shown in the UI).
              </>,
              <>
                Pick a type: <strong>Text</strong>, <strong>Number</strong>,{' '}
                <strong>Date</strong>, <strong>Boolean</strong>, or{' '}
                <strong>Select</strong> (one of N options).
              </>,
            ])}
            {H2('Use in merge tags')}
            {P(
              <>
                In the email editor, type{' '}
                {Code('{{subscription_plan}}')} anywhere you want the
                value substituted per recipient.
              </>,
            )}
            {H2('Use in segments')}
            {P(
              'Segments can filter on any custom field — "all contacts where subscription_plan = Pro and last_purchase_date in the last 30 days".',
            )}
          </>
        ),
      },
      {
        slug: 'build-segments',
        title: 'Build a segment with filters',
        summary:
          'Combine filters to target a specific slice of your contact list.',
        minutes: 5,
        body: (
          <>
            {P(
              'A segment is a saved filter over your contacts. Use it as the audience for any campaign — the segment evaluates fresh at send time, so you always email the current matching set.',
            )}
            {H2('Create')}
            {OL([
              <>
                Go to <strong>Audience → Segments → + New segment</strong>.
              </>,
              <>Name it (e.g. "Pro users in California, last 90 days").</>,
              <>Add rules with AND / OR logic.</>,
            ])}
            {H2('Filter types')}
            {UL([
              <>
                <strong>Identity</strong> — email status, phone status,
                subscribed since, source (import, signup, manual).
              </>,
              <>
                <strong>Custom field</strong> — any field you defined,
                with operators appropriate to the type (equals, contains,
                greater than, in last N days, etc.).
              </>,
              <>
                <strong>Tags</strong> — has any of these tags, has all of
                these tags.
              </>,
              <>
                <strong>Engagement</strong> — opened a campaign in the
                last N days, clicked a specific link, hasn’t opened in N
                days.
              </>,
            ])}
            {H2('Preview')}
            {P(
              'The preview panel shows the matching contact count and a sample of 10 rows. Refresh as you tweak rules.',
            )}
          </>
        ),
      },
      {
        slug: 'suppression-list',
        title: 'Manage your suppression list',
        summary:
          'See who’s blocked from receiving and add manual entries for compliance.',
        minutes: 3,
        body: (
          <>
            {P(
              'The suppression list tracks every address that should not receive marketing email — unsubscribes, hard bounces, spam complaints, and any addresses you manually add.',
            )}
            {H2('How entries get added automatically')}
            {UL([
              <>
                <strong>Unsubscribe</strong> — recipient clicked your
                unsubscribe link.
              </>,
              <>
                <strong>Hard bounce</strong> — permanent delivery
                failure.
              </>,
              <>
                <strong>Spam complaint</strong> — recipient marked your
                email as spam.
              </>,
            ])}
            {H2('Add a manual entry')}
            {OL([
              <>
                Go to <strong>Audience → Suppression</strong>.
              </>,
              <>
                Click <strong>+ Add entry</strong>.
              </>,
              <>Paste an email or phone, pick a reason.</>,
            ])}
            {Warn(
              <>
                Suppression is per-workspace and per-channel. An
                unsubscribe from email doesn’t suppress WhatsApp — those
                are separate consent regimes.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'handle-unsubscribes',
        title: 'Handle unsubscribes',
        summary:
          'How Getyn handles one-click unsubscribe and what to surface to recipients.',
        minutes: 4,
        body: (
          <>
            {P(
              'Every campaign email must include an unsubscribe link (CAN-SPAM, GDPR). Getyn auto-injects one if your design forgets, and supports Gmail/Yahoo’s one-click unsubscribe via the List-Unsubscribe header.',
            )}
            {H2('How the unsubscribe link works')}
            {OL([
              <>
                Email arrives with a {Code('{{unsubscribeUrl}}')} link in
                the footer.
              </>,
              <>
                Recipient clicks → lands on Getyn’s unsubscribe
                confirmation page.
              </>,
              <>
                Single click confirms — they’re marked{' '}
                <strong>UNSUBSCRIBED</strong> and added to the suppression
                list for that channel.
              </>,
            ])}
            {H2('One-click unsubscribe (Gmail)')}
            {P(
              'Gmail and Yahoo now require bulk senders to support the RFC 8058 one-click unsubscribe header. Getyn includes it automatically — recipients can unsubscribe from inside their inbox without leaving Gmail.',
            )}
            {H2('Re-subscribing')}
            {P(
              'An unsubscribed contact can re-subscribe only via explicit re-confirmation — you cannot un-unsubscribe them in the UI without a documented opt-in source. This is intentional.',
            )}
          </>
        ),
      },
    ],
  },
  {
    slug: 'ai-and-integrations',
    title: 'AI & integrations',
    description:
      'Use the AI Campaign Agent, generate images, and connect your sending stack.',
    icon: '✨',
    articles: [
      {
        slug: 'use-campaign-agent',
        title: 'Use the AI Campaign Agent',
        summary:
          'Draft email + WhatsApp campaigns through chat instead of building manually.',
        minutes: 4,
        body: (
          <>
            {P(
              'The AI Campaign Agent is a conversational interface for drafting campaigns. You describe what you want; it asks clarifying questions, picks blocks, writes copy, and hands off a polished DRAFT campaign you review and send.',
            )}
            {H2('Prerequisites')}
            {UL([
              <>Your brand profile is filled out (Settings → Brand).</>,
              <>An admin has added an Anthropic API key (admin only).</>,
              <>You have OWNER, ADMIN, or EDITOR role.</>,
            ])}
            {H2('Start a conversation')}
            {OL([
              <>
                On the campaigns page click <strong>Create with AI</strong>.
              </>,
              <>Pick Email or WhatsApp.</>,
              <>The agent introduces itself and asks the first question.</>,
            ])}
            {H2('What the agent does')}
            {UL([
              <>
                Reads your brand profile so drafts match your voice +
                colors.
              </>,
              <>
                Picks blocks from a vetted library of 12+ starter
                templates.
              </>,
              <>
                Writes subject lines, headlines, body copy, and CTAs.
              </>,
              <>
                Plans audience selection by reading your segments and
                proposing the best fit.
              </>,
              <>
                Hands off to the visual editor when ready —{' '}
                <strong>you have the final say</strong>.
              </>,
            ])}
            {Tip(
              <>
                Each conversation is capped at $0.50 in AI costs (visible
                in the chat footer). When you approach the cap, the
                agent finalizes with what it has.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'generate-images',
        title: 'Generate images with OpenAI',
        summary:
          'Use AI to create on-brand hero images, optionally inspired by an attached reference.',
        minutes: 4,
        body: (
          <>
            {P(
              'The AI Campaign Agent can generate images directly into your email design using OpenAI’s gpt-image-2 model. Useful when you need a hero image and don’t have one on hand.',
            )}
            {H2('Prerequisites')}
            {UL([
              <>
                An admin has added an OpenAI API key and enabled image
                generation in <strong>Admin → Global Integrations →
                AI LLMs</strong>.
              </>,
              <>You’re in an active agent conversation.</>,
            ])}
            {H2('Two ways to use images in agent drafts')}
            {OL([
              <>
                <strong>Attach + place</strong> — drag an image into chat
                (logo, product photo) and tell the agent to place it.
                Free, instant.
              </>,
              <>
                <strong>Generate</strong> — ask the agent to create a new
                image. Costs ~$0.005–$0.21 per image depending on
                quality. Capped at 3 generations per conversation.
              </>,
            ])}
            {H2('Reference-style generation')}
            {P(
              'Attach a brand image first, then ask the agent to "generate a hero image in this style". The agent extracts colors, mood, and composition from your reference and feeds them into the generation prompt.',
            )}
            {Tip(
              <>
                Write specific prompts. "Professional product photo of a
                leather backpack on a wooden desk, soft natural lighting"
                beats "a backpack" every time.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'smtp-setup',
        title: 'Configure SMTP for system emails',
        summary:
          'Route invitations, password resets, and notifications through your SMTP server.',
        minutes: 5,
        body: (
          <>
            {P(
              'System emails (user invitations, password resets, plan upgrade notices) can either go through the same Resend integration as marketing campaigns, or through a dedicated SMTP server you control. SMTP is configured per-platform by an admin.',
            )}
            {H2('Why use SMTP for system emails?')}
            {UL([
              <>
                Keep transactional + marketing send paths separate so a
                marketing reputation hit doesn’t silently kill password
                resets.
              </>,
              <>
                Use a custom from-address (e.g. {Code('no-reply@yourbrand.com')}).
              </>,
              <>
                Compliance — some industries require self-hosted email
                relays for audit trails.
              </>,
            ])}
            {H2('Configure')}
            {OL([
              <>
                Go to <strong>Admin → Global Integrations → Email SMTP</strong>{' '}
                (admin-only).
              </>,
              <>
                Enter SMTP host, port, encryption (STARTTLS or TLS),
                username, password.
              </>,
              <>Set the from-address, from-name, and optional reply-to.</>,
              <>
                Click <strong>Send test email</strong> to verify before
                enabling.
              </>,
              <>Toggle Enable SMTP — system emails now route here.</>,
            ])}
            {Warn(
              <>
                Marketing campaigns continue to send through Resend
                (separate integration). SMTP only affects system /
                transactional emails.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'resend-setup',
        title: 'Connect Resend for marketing sends',
        summary:
          'Add your Resend API key and verify domain so marketing campaigns send through your account.',
        minutes: 4,
        body: (
          <>
            {P(
              'Marketing campaigns send through Resend, which uses Amazon SES as its underlying infrastructure. You bring your own Resend account so usage + costs roll up to you.',
            )}
            {H2('Get your Resend API key')}
            {OL([
              <>
                Sign up at <strong>resend.com</strong> (free tier covers
                3k emails/month).
              </>,
              <>
                In Resend dashboard, go to <strong>API Keys → Create</strong>.
              </>,
              <>Copy the {Code('re_...')} key. It won’t be shown again.</>,
            ])}
            {H2('Add to Getyn')}
            {OL([
              <>
                Go to <strong>Admin → Global Integrations → Sending Servers
                → Resend</strong>.
              </>,
              <>Paste the API key.</>,
              <>Set the default from-address (must be on a verified domain).</>,
              <>
                Optionally paste the Resend webhook signing secret for
                event tracking.
              </>,
              <>Save and toggle Enable Resend.</>,
            ])}
            {H2('Verify your domain in Resend')}
            {P(
              <>
                The from-address domain must be verified in Resend before
                campaigns will send. See "Verify your sending domain" —
                same DNS records work for both.
              </>,
            )}
          </>
        ),
      },
      {
        slug: 'whatsapp-template-approval',
        title: 'Get a WhatsApp template approved',
        summary:
          'Draft a template, submit to Meta, and track approval status.',
        minutes: 5,
        body: (
          <>
            {P(
              'Meta requires every WhatsApp marketing template to be pre-approved before you can use it. Approval is usually fast (minutes to hours) but rejections happen for specific content patterns.',
            )}
            {H2('Draft a template')}
            {OL([
              <>
                Go to <strong>Communicate → WhatsApp → Templates</strong>.
              </>,
              <>
                Click <strong>+ New template</strong>.
              </>,
              <>
                Pick a category: <strong>Marketing</strong>,{' '}
                <strong>Utility</strong>, or <strong>Authentication</strong>.
              </>,
              <>Pick a language (e.g. en_US, hi).</>,
              <>
                Write the template: header (text or media), body, footer,
                buttons.
              </>,
              <>
                Use {Code('{{1}}')}, {Code('{{2}}')}, etc. for variables
                resolved per-recipient at send time.
              </>,
            ])}
            {H2('Submit to Meta')}
            {OL([
              <>
                Click <strong>Submit for approval</strong>.
              </>,
              <>
                Status flips to <strong>PENDING</strong> — Meta usually
                reviews within an hour.
              </>,
              <>
                Status changes to <strong>APPROVED</strong>,{' '}
                <strong>REJECTED</strong>, or <strong>FLAGGED</strong>.
              </>,
            ])}
            {H2('Why templates get rejected')}
            {UL([
              <>
                Marketing template that reads like transactional (or
                vice-versa).
              </>,
              <>Vague variables ("Hi {Code('{{1}}')}!" with no context).</>,
              <>Banned phrases ("click here", "free money", "limited time" without proof).</>,
              <>Mismatched category — promotional content in Utility templates.</>,
            ])}
            {Tip(
              <>
                Use the AI agent’s "draft template" action — it knows
                Meta’s common rejection patterns and produces submission-
                ready drafts.
              </>,
            )}
          </>
        ),
      },
    ],
  },
  // -------------------------------------------------------------------------
  // WhatsApp campaigns
  // -------------------------------------------------------------------------
  {
    slug: 'whatsapp-campaigns',
    title: 'WhatsApp campaigns',
    description:
      'Connect your WABA, submit templates, broadcast to segments, and reply from the unified inbox.',
    icon: '💬',
    articles: [
      {
        slug: 'connect-your-waba',
        title: 'Connect your WhatsApp Business Account',
        summary:
          'Bring your own WABA from Meta Business Manager so Getyn can send templates on your behalf.',
        minutes: 4,
        body: (
          <>
            {P(
              'Getyn Campaigns sends WhatsApp messages through your own WhatsApp Business Account (WABA). You own the WABA inside Meta Business Manager — Getyn just gets permission to send on your behalf. No numbers are shared across tenants.',
            )}
            {H2('Before you start')}
            {UL([
              <>A verified business in Meta Business Manager.</>,
              <>At least one phone number not already on personal WhatsApp.</>,
              <>Admin access to your WABA inside Business Manager.</>,
            ])}
            {H2('Connect')}
            {OL([
              <>
                Open <strong>Channels → WhatsApp</strong> in the sidebar.
              </>,
              <>
                Click <strong>Connect WhatsApp</strong>. You will be
                redirected to Meta&rsquo;s Embedded Signup flow in a new tab.
              </>,
              <>
                Pick the WABA + phone number you want to connect and grant
                the requested permissions.
              </>,
              <>
                You&rsquo;ll be sent back to Getyn. The tab shows{' '}
                {Code('CONNECTED')} with your display name and quality
                rating within a few seconds.
              </>,
            ])}
            {Tip(
              <>
                Multiple numbers under one WABA are supported — the
                campaign builder lets you pick which one each campaign
                sends from.
              </>,
            )}
            {H2('What happens next')}
            {UL([
              <>
                Approved templates on your WABA sync automatically into
                Getyn within a minute.
              </>,
              <>
                Inbound messages flow into the Unified Inbox and can
                trigger WhatsApp Inbound flows.
              </>,
            ])}
            {Related([
              [
                'whatsapp-campaigns',
                'submit-template-for-approval',
                'Submit a WhatsApp template for approval',
              ],
              [
                'whatsapp-campaigns',
                'send-first-whatsapp-campaign',
                'Send your first WhatsApp campaign',
              ],
              [
                'whatsapp-campaigns',
                'whatsapp-opt-in-out',
                'WhatsApp opt-in and opt-out best practices',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'submit-template-for-approval',
        title: 'Submit a WhatsApp template for approval',
        summary:
          'Create, author, and submit a template to Meta from inside Getyn — approvals usually land in 1–24 hours.',
        minutes: 5,
        body: (
          <>
            {P(
              'WhatsApp broadcast campaigns can only send approved templates. You author the template once, Meta approves it, and then you reuse it across campaigns with per-recipient variables.',
            )}
            {H2('Create a template')}
            {OL([
              <>
                Go to{' '}
                <strong>Channels → WhatsApp → Templates → New template</strong>.
              </>,
              <>
                Name it (internal — your team sees this) and pick a{' '}
                <strong>category</strong>: Marketing, Utility, or
                Authentication.
              </>,
              <>
                Pick a language code (e.g. {Code('en_US')}, {Code('en_GB')},{' '}
                {Code('hi')}).
              </>,
              <>
                Write the body. Variables are {Code('{{1}}')}, {Code('{{2}}')}
                , etc. and are resolved per-recipient at send time.
              </>,
              <>
                Optionally add a header (text, image, video, or document),
                footer, and up to three buttons (URL, phone, or quick
                reply).
              </>,
              <>
                Click <strong>Submit for approval</strong>.
              </>,
            ])}
            {H2('Approval timelines')}
            {UL([
              <>Utility templates: usually a few minutes.</>,
              <>Marketing templates: 1–24 hours.</>,
              <>Authentication: often instant.</>,
            ])}
            {Warn(
              <>
                Marketing templates with promotional language in a Utility
                category will be rejected. Pick the category that matches
                the message intent, not the one you&rsquo;d prefer.
              </>,
            )}
            {Related([
              [
                'whatsapp-campaigns',
                'template-categories',
                'Understanding template categories',
              ],
              [
                'whatsapp-campaigns',
                'variables-and-media',
                'Using variables and media headers',
              ],
              [
                'whatsapp-campaigns',
                'send-first-whatsapp-campaign',
                'Send your first WhatsApp campaign',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'send-first-whatsapp-campaign',
        title: 'Send your first WhatsApp campaign',
        summary:
          'Pick a template, a segment, and hit send — Getyn fills variables per recipient and reports delivery.',
        minutes: 4,
        body: (
          <>
            {P(
              'A WhatsApp campaign fires an approved template to every contact in a segment, resolving variables per recipient at send time.',
            )}
            {H2('Build the campaign')}
            {OL([
              <>
                Click <strong>New campaign → Build WhatsApp manually</strong>.
              </>,
              <>
                <strong>Identity:</strong> name the campaign and pick the
                recipient segment.
              </>,
              <>
                <strong>Content:</strong> pick an approved template. Map
                each variable to a contact field or a static value. A
                live preview on the right shows the rendered message for
                a sample contact.
              </>,
              <>
                <strong>Review:</strong> confirm the sending number,
                schedule (send now or later), and the plan-gate (e.g.
                {' '}&ldquo;You&rsquo;ll use 250 of your 10,000 WhatsApp
                messages this month&rdquo;). Then send.
              </>,
            ])}
            {Tip(
              <>
                Contacts on your WhatsApp suppression list are excluded
                automatically. Review opt-outs in{' '}
                <strong>Audience → Suppression</strong>.
              </>,
            )}
            {Related([
              [
                'whatsapp-campaigns',
                'measure-whatsapp-results',
                'Measure WhatsApp campaign results',
              ],
              [
                'whatsapp-campaigns',
                'whatsapp-inbox-and-replies',
                'WhatsApp inbox and replies',
              ],
              [
                'automation-and-flows',
                'whatsapp-outbound-flow',
                'Build a WhatsApp Outbound broadcast flow',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'template-categories',
        title: 'Understanding template categories',
        summary:
          'Marketing, Utility, Authentication — pick the right one or Meta will re-categorise (and bill) you.',
        minutes: 3,
        body: (
          <>
            {P(
              'Meta categorises every WhatsApp template. The category affects approval likelihood, pricing, and whether a 24-hour service window applies.',
            )}
            {H2('Marketing')}
            {UL([
              <>Promotions, offers, new product announcements.</>,
              <>Highest per-message cost, strictest approval bar.</>,
              <>Requires explicit opt-in.</>,
            ])}
            {H2('Utility')}
            {UL([
              <>
                Post-purchase: order updates, shipping notices, booking
                confirmations, OTPs for account activity.
              </>,
              <>Lower cost, faster approvals.</>,
              <>Still needs opt-in but service-window friendly.</>,
            ])}
            {H2('Authentication')}
            {UL([
              <>One-time passwords, verification codes only.</>,
              <>Cheapest category — often free in some regions.</>,
              <>No promotional content allowed.</>,
            ])}
            {Warn(
              <>
                If Meta decides your Utility template is actually
                Marketing, it&rsquo;s re-categorised and billed at the
                Marketing rate. Match category to intent honestly.
              </>,
            )}
            {Related([
              [
                'whatsapp-campaigns',
                'submit-template-for-approval',
                'Submit a WhatsApp template for approval',
              ],
              [
                'whatsapp-campaigns',
                'whatsapp-opt-in-out',
                'WhatsApp opt-in and opt-out best practices',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'variables-and-media',
        title: 'Using variables and media headers',
        summary:
          'Personalise every template with contact fields and a hero image, video, or document.',
        minutes: 4,
        body: (
          <>
            {P(
              'Variables and media headers make a single template feel personal. Variables are mapped once per campaign and resolved per recipient at send.',
            )}
            {H2('Body variables')}
            {OL([
              <>
                Use {Code('{{1}}')}, {Code('{{2}}')}, {Code('{{3}}')} in
                your template body.
              </>,
              <>
                In the campaign&rsquo;s Content step, map each variable to:
              </>,
            ])}
            {UL([
              <>
                A contact field like <strong>First name</strong>,{' '}
                <strong>Company</strong>, or any custom field.
              </>,
              <>A static value used for every recipient in that send.</>,
              <>
                A fallback (used when the per-contact value is empty).
              </>,
            ])}
            {H2('Media headers')}
            {UL([
              <>
                <strong>Image / video / document headers</strong> upload
                once per campaign and are reused for every recipient.
              </>,
              <>
                Images &le; 5 MB (JPG/PNG), video &le; 16 MB, document
                &le; 100 MB.
              </>,
              <>
                Document headers display the filename in the chat — keep
                it meaningful.
              </>,
            ])}
            {Tip(
              <>
                Need per-recipient images? Use a dynamic URL via a
                variable in a URL button instead of a media header.
              </>,
            )}
            {Related([
              [
                'whatsapp-campaigns',
                'send-first-whatsapp-campaign',
                'Send your first WhatsApp campaign',
              ],
              [
                'contacts-and-segments',
                'custom-fields',
                'Create a custom field',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'whatsapp-inbox-and-replies',
        title: 'WhatsApp inbox and replies',
        summary:
          'Reply to inbound customer messages from the Unified Inbox and keep context across team members.',
        minutes: 4,
        body: (
          <>
            {P(
              'Every inbound WhatsApp message lands in the Unified Inbox (sidebar → Unified Inbox → WhatsApp tab). Threads are per-contact so history stays in one place.',
            )}
            {H2('Reply to a thread')}
            {OL([
              <>Open the thread from the list on the left.</>,
              <>
                Type a reply in the composer. Inside the{' '}
                <strong>24-hour service window</strong> you can send free-form
                text; outside the window you must pick an approved template.
              </>,
              <>
                Attach media (up to WhatsApp&rsquo;s per-type limits) and
                send.
              </>,
            ])}
            {H2('Assign and tag')}
            {UL([
              <>
                Assign the thread to a teammate so replies route to the
                right person.
              </>,
              <>Add contact tags from the right-side panel for later segmentation.</>,
              <>Mark the thread resolved to drop it off the active list.</>,
            ])}
            {Tip(
              <>
                Consider pairing busy numbers with an Autonomous WhatsApp
                Agent to triage inbound traffic and escalate to a human
                when needed.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'autonomous-agents-overview',
                'Autonomous agents overview',
              ],
              [
                'whatsapp-campaigns',
                'measure-whatsapp-results',
                'Measure WhatsApp campaign results',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'measure-whatsapp-results',
        title: 'Measure WhatsApp campaign results',
        summary:
          'Read the funnel: sent → delivered → read → replied → clicked.',
        minutes: 3,
        body: (
          <>
            {P(
              'Open any WhatsApp campaign to see its funnel. Numbers update in near-real-time from Meta&rsquo;s webhook stream.',
            )}
            {H2('Key metrics')}
            {UL([
              <>
                <strong>Sent</strong> — request accepted by Meta.
              </>,
              <>
                <strong>Delivered</strong> — handset acknowledged.
              </>,
              <>
                <strong>Read</strong> — recipient has WhatsApp read
                receipts enabled and opened the message.
              </>,
              <>
                <strong>Replied</strong> — recipient sent any inbound
                message within the service window.
              </>,
              <>
                <strong>Button clicks</strong> — URL / quick-reply button
                hits, broken down per button.
              </>,
            ])}
            {H2('Where to look')}
            {UL([
              <>
                Per-campaign view: the campaign&rsquo;s detail page.
              </>,
              <>
                Workspace-wide: <strong>Analytics → WhatsApp campaigns</strong>.
              </>,
            ])}
            {Related([
              [
                'analytics-and-deliverability',
                'whatsapp-funnel-metrics',
                'WhatsApp funnel metrics explained',
              ],
              [
                'whatsapp-campaigns',
                'send-first-whatsapp-campaign',
                'Send your first WhatsApp campaign',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'whatsapp-opt-in-out',
        title: 'WhatsApp opt-in and opt-out best practices',
        summary:
          'Stay on the right side of Meta&rsquo;s policy — and protect your quality rating.',
        minutes: 4,
        body: (
          <>
            {P(
              'WhatsApp is a trust-forward channel. Low quality ratings cap your throughput and can trigger template re-reviews. Opt-in and opt-out hygiene is the single biggest lever on quality rating.',
            )}
            {H2('Collecting opt-in')}
            {UL([
              <>Clear checkbox or CTA at signup specifying WhatsApp.</>,
              <>
                Store the source and timestamp — Getyn records them
                automatically on contacts created via forms, API, or
                import with an {Code('opt_in_source')} field.
              </>,
              <>Do not import bought lists.</>,
            ])}
            {H2('Honouring opt-out')}
            {UL([
              <>
                When a contact replies STOP, UNSUBSCRIBE, or similar,
                Getyn flips them to{' '}
                {Code('whatsapp_status = UNSUBSCRIBED')} and adds them
                to the WhatsApp suppression list.
              </>,
              <>Campaign sends skip suppressed contacts automatically.</>,
              <>
                Send a one-time confirmation (template) acknowledging the
                opt-out.
              </>,
            ])}
            {Warn(
              <>
                Low quality ratings on your number can cap throughput to
                1k/day until recovered. Fix quality early.
              </>,
            )}
            {Related([
              ['contacts-and-segments', 'handle-unsubscribes', 'Handle unsubscribes'],
              ['contacts-and-segments', 'suppression-list', 'The suppression list'],
            ] as const)}
          </>
        ),
      },
    ],
  },
  // -------------------------------------------------------------------------
  // SMS campaigns
  // -------------------------------------------------------------------------
  {
    slug: 'sms-campaigns',
    title: 'SMS campaigns',
    description:
      'Buy numbers, register sender IDs, and broadcast SMS through your own Twilio account.',
    icon: '📱',
    articles: [
      {
        slug: 'configure-twilio',
        title: 'Configure your Twilio integration',
        summary:
          'Admin-side one-time setup so tenants can procure numbers and send SMS through your Twilio account.',
        minutes: 4,
        body: (
          <>
            {P(
              'SMS sending runs on Twilio. The admin configures the Twilio Account SID and Auth Token once; tenants then buy numbers or register sender IDs from inside their workspace.',
            )}
            {H2('Add credentials')}
            {OL([
              <>
                Go to <strong>/admin/integrations/sms-servers</strong>.
              </>,
              <>
                Paste your Twilio <strong>Account SID</strong> and{' '}
                <strong>Auth Token</strong>.
              </>,
              <>Pick a default from-number (used when a tenant has none).</>,
              <>
                Tick <strong>Enabled</strong> and save.
              </>,
            ])}
            {H2('Test the connection')}
            {OL([
              <>
                Click <strong>Send test SMS</strong>.
              </>,
              <>Enter a destination number in E.164 ({Code('+14155550123')}).</>,
              <>
                Confirm you received the test message — Twilio returned a
                SID, Getyn persisted it.
              </>,
            ])}
            {Warn(
              <>
                Credentials are encrypted at rest using the same
                envelope the SMTP integration uses. Rotate by pasting
                new values and saving.
              </>,
            )}
            {Related([
              ['sms-campaigns', 'buy-a-phone-number', 'Buy a phone number'],
              [
                'sms-campaigns',
                'register-alpha-sender',
                'Register an alphanumeric sender ID',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'buy-a-phone-number',
        title: 'Buy a phone number for your country',
        summary:
          'Procure a Twilio number via xPay — Getyn auto-provisions on PAID.',
        minutes: 3,
        body: (
          <>
            {P(
              'Tenants procure phone numbers for use as SMS caller IDs. Country selection, availability search, and purchase all happen inside Channels — the xPay checkout and Twilio purchase are automatic.',
            )}
            {H2('Procure')}
            {OL([
              <>
                Open <strong>Channels → SMS → Phone numbers</strong>.
              </>,
              <>
                Pick a country (ISO2 with flag). Optionally add an area
                code or a &ldquo;contains&rdquo; filter to narrow results.
              </>,
              <>
                Click <strong>Search</strong>. Browse available numbers
                with per-number monthly price.
              </>,
              <>
                Click <strong>Buy</strong>. xPay checkout opens in a new
                tab.
              </>,
              <>
                On successful payment, Getyn calls Twilio to purchase the
                number, saves it to your workspace, and fires a{' '}
                <strong>SMS number purchased</strong> notification.
              </>,
            ])}
            {Tip(
              <>
                Local numbers typically have best deliverability for the
                matching country. Toll-free is a good fallback where
                mobile numbers aren&rsquo;t available (notably US A2P).
              </>,
            )}
            {Related([
              [
                'sms-campaigns',
                'register-alpha-sender',
                'Register an alphanumeric sender ID',
              ],
              [
                'sms-campaigns',
                'send-first-sms-campaign',
                'Send your first SMS campaign',
              ],
              ['billing-and-plans', 'how-xpay-checkout-works', 'How xPay checkout works'],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'register-alpha-sender',
        title: 'Register an alphanumeric sender ID',
        summary:
          'Use your brand name (e.g. MSFT) as the caller ID in supported countries.',
        minutes: 3,
        body: (
          <>
            {P(
              'Alphanumeric sender IDs let your SMS arrive showing your brand name instead of a phone number. They&rsquo;re cheaper than a long-code, but availability is per-destination-country.',
            )}
            {H2('Register')}
            {OL([
              <>
                Open <strong>Channels → SMS → Sender IDs</strong>.
              </>,
              <>
                Enter 1–11 alphanumeric characters (letters, digits).
                Uppercase recommended.
              </>,
              <>
                Pick the destination country. Only supported countries are
                listed.
              </>,
              <>
                Click <strong>Submit</strong>. Some countries approve
                instantly; others need form submission at Twilio&rsquo;s
                end — you&rsquo;ll see {Code('PENDING_SUBMISSION')} or{' '}
                {Code('SUBMITTED')} as status.
              </>,
            ])}
            {Warn(
              <>
                Alphanumeric sender IDs are NOT supported for US or
                Canada — use a purchased long-code or short-code there.
              </>,
            )}
            {H2('Supported destinations')}
            {P(
              'UK, Germany, France, India, Australia, and many others — see Twilio&rsquo;s official list for the current set. Getyn only shows countries Twilio reports as supported.',
            )}
            {Related([
              ['sms-campaigns', 'buy-a-phone-number', 'Buy a phone number'],
              [
                'sms-campaigns',
                'sms-deliverability',
                'SMS deliverability best practices',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'send-first-sms-campaign',
        title: 'Send your first SMS campaign',
        summary:
          'Compose, pick a sender, schedule, send. Watch the segment counter.',
        minutes: 3,
        body: (
          <>
            {P(
              'SMS campaigns are a straightforward one-shot broadcast. Pick the segment, write the body with merge tags, and the live counter tells you how many SMS segments each message will consume.',
            )}
            {H2('Compose')}
            {OL([
              <>
                Click <strong>New campaign → Build SMS manually</strong>.
              </>,
              <>Name the campaign and pick a segment.</>,
              <>
                Pick the from-sender — any purchased number or approved
                sender ID. Falls back to the admin default if none.
              </>,
              <>
                Write the body. Use merge tags like {Code('{{first_name}}')}.
                Counter below shows{' '}
                <strong>characters / 160 (GSM-7)</strong> or{' '}
                <strong>characters / 70 (UCS-2)</strong> plus segment
                count.
              </>,
              <>Choose send now or schedule for later. Hit send.</>,
            ])}
            {Tip(
              <>
                Each message past 160 GSM-7 characters (or 70 UCS-2)
                splits into a second segment, each billed separately.
                Keep marketing to one segment where possible.
              </>,
            )}
            {Related([
              [
                'sms-campaigns',
                'understand-sms-segments',
                'Understanding SMS segments',
              ],
              [
                'sms-campaigns',
                'sms-suppression-opt-outs',
                'SMS suppression and opt-outs',
              ],
              [
                'analytics-and-deliverability',
                'sms-delivery-analytics',
                'SMS delivery analytics',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'understand-sms-segments',
        title: 'Understanding SMS segments (GSM-7 vs UCS-2)',
        summary:
          'Why a 161-character SMS costs twice as much — and what characters silently break the budget.',
        minutes: 3,
        body: (
          <>
            {P(
              'SMS billing is per segment, not per message. One &ldquo;message&rdquo; of 300 characters is actually 2–3 billable segments. Which encoding your message uses changes the budget dramatically.',
            )}
            {H2('GSM-7 (standard)')}
            {UL([
              <>Plain Latin letters, digits, basic punctuation.</>,
              <>
                160 characters per segment; multi-segment messages drop to
                153 chars/segment to make room for a concat header.
              </>,
            ])}
            {H2('UCS-2 (extended)')}
            {UL([
              <>
                Triggered the instant a single emoji, Hindi character,
                Chinese character, Arabic character, or curly quote
                (&ldquo;smart quote&rdquo;) appears.
              </>,
              <>
                Only <strong>70 characters</strong> per segment; 67
                chars/segment multi-segment.
              </>,
            ])}
            {Warn(
              <>
                Pasting from Google Docs or Word often inserts curly
                quotes — silently flipping the message to UCS-2 and
                halving your segment budget. The campaign composer
                highlights this.
              </>,
            )}
            {Related([
              [
                'sms-campaigns',
                'send-first-sms-campaign',
                'Send your first SMS campaign',
              ],
              [
                'analytics-and-deliverability',
                'sms-delivery-analytics',
                'SMS delivery analytics',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'sms-suppression-opt-outs',
        title: 'SMS suppression and opt-outs',
        summary:
          'STOP / HELP are mandatory in most regions — Getyn handles them automatically.',
        minutes: 3,
        body: (
          <>
            {P(
              'US A2P, UK, Australia, and most SMS regulators require that recipients can opt out with a one-word reply. Getyn parses inbound Twilio messages and acts on them for you.',
            )}
            {H2('Automatic handling')}
            {UL([
              <>
                {Code('STOP')}, {Code('UNSUBSCRIBE')},{' '}
                {Code('CANCEL')}, {Code('END')}, {Code('QUIT')}{' '}
                → contact added to SMS suppression + opt-out ack sent.
              </>,
              <>
                {Code('HELP')}, {Code('INFO')} → short brand-name
                reply with contact info.
              </>,
              <>
                {Code('START')}, {Code('YES')}, {Code('UNSTOP')}{' '}
                → re-subscribe from suppression.
              </>,
            ])}
            {H2('Where to check')}
            {UL([
              <>
                <strong>Audience → Suppression</strong> — SMS tab shows
                every opted-out contact with reason + timestamp.
              </>,
              <>
                Suppressed contacts are excluded from all SMS campaign
                sends automatically.
              </>,
            ])}
            {Tip(
              <>
                Include &ldquo;Reply STOP to opt out&rdquo; in marketing
                messages. It&rsquo;s required by most carriers and
                improves trust.
              </>,
            )}
            {Related([
              ['contacts-and-segments', 'suppression-list', 'The suppression list'],
              [
                'sms-campaigns',
                'sms-deliverability',
                'SMS deliverability best practices',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'sms-deliverability',
        title: 'SMS deliverability best practices',
        summary:
          'Register, warm, and shape — the three levers that protect your SMS delivery rate.',
        minutes: 4,
        body: (
          <>
            {P(
              'SMS carriers aggressively filter traffic they perceive as spam. Three practices keep your delivery rate high.',
            )}
            {H2('Register')}
            {UL([
              <>
                US A2P 10DLC: register your brand and campaigns via the
                Twilio console. Unregistered traffic is heavily throttled.
              </>,
              <>UK: register sender IDs per Section 7 guidance.</>,
              <>India: DLT registration mandatory for both number and content template.</>,
            ])}
            {H2('Warm')}
            {UL([
              <>
                Gradually ramp volume on a new number — doubling per day
                is a reasonable curve for the first week.
              </>,
              <>
                Mix transactional and promotional traffic where possible —
                100% marketing looks like a spam pattern.
              </>,
            ])}
            {H2('Shape')}
            {UL([
              <>Avoid shorteners. Use your own branded short URL.</>,
              <>
                Don&rsquo;t ALL CAPS. Don&rsquo;t pack with emojis.
              </>,
              <>Include brand name within the first 20 characters.</>,
            ])}
            {Related([
              [
                'sms-campaigns',
                'understand-sms-segments',
                'Understanding SMS segments',
              ],
              [
                'sms-campaigns',
                'sms-suppression-opt-outs',
                'SMS suppression and opt-outs',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'measure-sms-delivery',
        title: 'Measure SMS delivery',
        summary:
          'Sent, delivered, failed — and what each failure code actually means.',
        minutes: 3,
        body: (
          <>
            {P(
              'Twilio status callbacks stream delivery updates into Getyn. Each per-recipient SmsCampaignSend row carries a live status plus the Twilio error code on failure.',
            )}
            {H2('Statuses you&rsquo;ll see')}
            {UL([
              <>
                <strong>QUEUED</strong> — accepted by Twilio, not yet
                handed to the carrier.
              </>,
              <>
                <strong>SENT</strong> — handed to the carrier.
              </>,
              <>
                <strong>DELIVERED</strong> — carrier confirmed handset
                receipt.
              </>,
              <>
                <strong>FAILED</strong> / <strong>UNDELIVERED</strong> —
                check the error code column. Common ones: 30003 (handset
                unreachable), 30005 (unknown destination), 30007
                (carrier filtered as spam), 21610 (contact opted out).
              </>,
            ])}
            {H2('Where to read it')}
            {UL([
              <>
                Campaign detail page: aggregate funnel + per-row drill-in.
              </>,
              <>
                <strong>Analytics → SMS campaigns</strong> — per-campaign
                table, delivery funnel chart.
              </>,
            ])}
            {Related([
              [
                'analytics-and-deliverability',
                'sms-delivery-analytics',
                'SMS delivery analytics',
              ],
              [
                'sms-campaigns',
                'sms-deliverability',
                'SMS deliverability best practices',
              ],
            ] as const)}
          </>
        ),
      },
    ],
  },
  // -------------------------------------------------------------------------
  // Automation and flows
  // -------------------------------------------------------------------------
  {
    slug: 'automation-and-flows',
    title: 'Automation and flows',
    description:
      'Drip campaigns, inbound WhatsApp flows, autonomous agents, and the approval inbox.',
    icon: '⚡',
    articles: [
      {
        slug: 'drip-vs-one-shot',
        title: 'Drip campaigns vs one-shot campaigns',
        summary:
          'When to use the campaign builder vs when to build a flow.',
        minutes: 3,
        body: (
          <>
            {P(
              'Both live in the sidebar, but they do different jobs. Picking the right tool keeps your team out of a mess of overlapping campaigns.',
            )}
            {H2('One-shot campaigns')}
            {UL([
              <>Fire once to a segment at a scheduled time.</>,
              <>
                Best for: Black Friday blast, new product announcement,
                monthly newsletter.
              </>,
              <>
                You own when it sends. Contacts added to the segment
                after the send are NOT included.
              </>,
            ])}
            {H2('Drip campaigns / flows')}
            {UL([
              <>Triggered per-contact when a condition is met.</>,
              <>
                Best for: welcome series, abandoned cart, inbound WhatsApp
                reply tree, post-signup nurture.
              </>,
              <>
                Runs forever — every new contact meeting the trigger
                enrols automatically.
              </>,
            ])}
            {Tip(
              <>
                If you&rsquo;re copy-pasting the same one-shot every
                month, it&rsquo;s probably a drip in disguise.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'email-outbound-flow',
                'Create an Email Outbound flow',
              ],
              [
                'automation-and-flows',
                'whatsapp-outbound-flow',
                'Build a WhatsApp Outbound broadcast flow',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'email-outbound-flow',
        title: 'Create an Email Outbound flow',
        summary:
          'Welcome series example: new contact → delay → send email → wait → send follow-up.',
        minutes: 4,
        body: (
          <>
            {P(
              'An Email Outbound flow enrols every contact that matches a trigger (segment entry, tag applied, custom event) and walks them through a sequence of email steps.',
            )}
            {H2('Build it')}
            {OL([
              <>
                <strong>Drip Campaigns → New</strong>. Pick kind:{' '}
                <strong>Email — Outbound</strong>.
              </>,
              <>
                Trigger: pick <strong>Enters segment</strong> and a
                segment like &ldquo;All signups last 24h&rdquo;.
              </>,
              <>
                Drop <strong>Send email</strong> → choose a template.
              </>,
              <>
                Drop <strong>Delay</strong> → 2 days.
              </>,
              <>
                Drop <strong>Branch on open</strong> → opened vs not.
              </>,
              <>Each branch sends a different follow-up template.</>,
              <>
                Flip the flow to <strong>Active</strong>.
              </>,
            ])}
            {Tip(
              <>
                Use the <strong>Analytics → Drip / Flows</strong> tab to
                watch enrolments, step-completion rate, and drop-off per
                step.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'branching-and-conditions',
                'Branching on replies, tags, and conditions',
              ],
              [
                'automation-and-flows',
                'delays-and-scheduling',
                'Delays and scheduling',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'whatsapp-outbound-flow',
        title: 'Build a WhatsApp Outbound broadcast flow',
        summary:
          'Broadcast → wait → nudge non-responders → tag responders.',
        minutes: 4,
        body: (
          <>
            {P(
              'A WhatsApp Outbound flow combines a one-shot broadcast with automated follow-ups based on reply behaviour.',
            )}
            {H2('Build it')}
            {OL([
              <>
                <strong>Drip Campaigns → New → WhatsApp — Outbound</strong>.
              </>,
              <>
                Trigger: pick <strong>Manual start on segment</strong>.
              </>,
              <>
                Step 1: <strong>Send template</strong> → pick your
                approved broadcast template, map variables.
              </>,
              <>
                Step 2: <strong>Branch on reply</strong> → replied vs not
                within 24h.
              </>,
              <>Replied branch: tag the contact &ldquo;interested&rdquo;, end.</>,
              <>Non-reply branch: delay 2 days → send a lighter nudge template.</>,
              <>
                Activate and click <strong>Enrol segment</strong>.
              </>,
            ])}
            {Tip(
              <>
                Only the step palette available for the current flow
                kind shows. Email steps are hidden on WhatsApp flows —
                no risk of accidentally mixing channels.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'whatsapp-inbound-flow',
                'Build a WhatsApp Inbound reply flow',
              ],
              [
                'whatsapp-campaigns',
                'send-first-whatsapp-campaign',
                'Send your first WhatsApp campaign',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'whatsapp-inbound-flow',
        title: 'Build a WhatsApp Inbound reply flow',
        summary:
          'Turn inbound customer messages into an auto-responding support tree.',
        minutes: 5,
        body: (
          <>
            {P(
              'A WhatsApp Inbound flow fires when a customer sends your WABA a message. Use it for FAQs, order status lookups, and escalation to a human.',
            )}
            {H2('Build it')}
            {OL([
              <>
                <strong>Drip Campaigns → New → WhatsApp — Inbound</strong>.
              </>,
              <>
                Trigger: pick <strong>Any inbound message</strong>, or a
                specific keyword / phone-number filter.
              </>,
              <>
                Step 1: <strong>Send template</strong> → greeting +
                quick-reply buttons (Pricing / Support / Human).
              </>,
              <>
                Step 2: <strong>Branch on reply</strong> → one lane per
                button or keyword.
              </>,
              <>
                Step 3 on &ldquo;Human&rdquo; lane: <strong>Hand off to agent</strong>.
                Thread assigns to the on-duty teammate.
              </>,
              <>Activate.</>,
            ])}
            {Warn(
              <>
                Inbound flows run alongside the Autonomous WhatsApp
                Agent. If both match, the flow wins — design accordingly.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'autonomous-agents-overview',
                'Autonomous agents overview',
              ],
              [
                'whatsapp-campaigns',
                'whatsapp-inbox-and-replies',
                'WhatsApp inbox and replies',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'branching-and-conditions',
        title: 'Branching on replies, tags, and conditions',
        summary:
          'The branch node is where flows get smart.',
        minutes: 3,
        body: (
          <>
            {P(
              'Branches split the flow by any property of the contact or the event that just happened. They keep flows compact — one flow handles both the happy path and the exception.',
            )}
            {H2('Branch types')}
            {UL([
              <>
                <strong>On open / click</strong> (email flows): did they
                open or click the previous step within N days?
              </>,
              <>
                <strong>On reply</strong> (WhatsApp flows): did they
                reply at all, or with a specific keyword?
              </>,
              <>
                <strong>On tag</strong>: does the contact carry a
                specific tag right now?
              </>,
              <>
                <strong>On field</strong>: compare any contact field to a
                value (e.g. {Code('country == "IN"')}).
              </>,
            ])}
            {Tip(
              <>
                Two branches max per decision — deeply nested branches
                become unreadable. Pull sub-trees into their own flow
                and cross-enrol with an <strong>Enrol in flow</strong>{' '}
                node.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'delays-and-scheduling',
                'Delays and scheduling',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'delays-and-scheduling',
        title: 'Delays and scheduling',
        summary:
          'Wait N days / until a time of day / until a weekday — the three dials you need.',
        minutes: 3,
        body: (
          <>
            {P(
              'Delay nodes are deceptively powerful. The right wait keeps re-engagement warm without pestering.',
            )}
            {H2('Delay modes')}
            {UL([
              <>
                <strong>Fixed duration</strong>: wait 2 hours, 3 days, 1
                week.
              </>,
              <>
                <strong>Until time of day</strong>: wait until next
                09:00 in the contact&rsquo;s timezone. Prevents 3am sends
                in APAC.
              </>,
              <>
                <strong>Until weekday</strong>: wait until next Tuesday.
                Useful for B2B — sending at 2am Saturday wastes a step.
              </>,
            ])}
            {Warn(
              <>
                Contacts with unknown timezone fall back to the
                workspace timezone (<strong>Settings → Workspace</strong>).
                Set this early.
              </>,
            )}
            {Related([
              [
                'automation-and-flows',
                'email-outbound-flow',
                'Create an Email Outbound flow',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'autonomous-agents-overview',
        title: 'Autonomous agents overview',
        summary:
          'Email + WhatsApp agents answer customers end-to-end without you touching the keyboard.',
        minutes: 4,
        body: (
          <>
            {P(
              'Autonomous Campaigns live in the Automation section. They&rsquo;re always-on, AI-powered agents that reply to inbound traffic on your behalf with a persona, goal, knowledge base, and escalation rules you set.',
            )}
            {H2('What each agent does')}
            {UL([
              <>
                <strong>Email Agent</strong> — handles support-style
                inbound email with your voice and brand knowledge.
              </>,
              <>
                <strong>WhatsApp Agent</strong> — same, but for inbound
                WhatsApp.
              </>,
            ])}
            {H2('Set up with AI')}
            {P(
              'Both agents have a Set-up-with-AI button on the top right of the wizard. Describe what you want ("Agent that answers pricing + books demos"), optionally dictate via the mic button, and Getyn AI fills the Persona + Goal fields. The rest (knowledge URL, schedule, templates, review) is yours.',
            )}
            {H2('Escalation')}
            {UL([
              <>
                When the agent isn&rsquo;t confident, it routes the
                thread to the Approval Inbox.
              </>,
              <>
                Your team reviews the drafted reply, edits if needed,
                and sends.
              </>,
            ])}
            {Related([
              [
                'automation-and-flows',
                'approval-inbox',
                'Set up the approval inbox',
              ],
              [
                'ai-and-integrations',
                'use-campaign-agent',
                'Use the campaign agent',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'approval-inbox',
        title: 'Set up the approval inbox',
        summary:
          'The safety net for autonomous agents — review and release drafts.',
        minutes: 3,
        body: (
          <>
            {P(
              'The Approval Inbox collects every reply an autonomous agent is uncertain about. Your team reviews, edits, and sends.',
            )}
            {H2('How it works')}
            {OL([
              <>
                Inbound hits an agent. The agent generates a draft and
                scores its own confidence.
              </>,
              <>
                Low confidence → draft lands in the Approval Inbox
                instead of sending.
              </>,
              <>
                A teammate opens the draft, edits if needed, and clicks{' '}
                <strong>Approve + send</strong>.
              </>,
              <>
                High confidence → sends automatically unless you&rsquo;ve
                set the agent to <strong>Always ask</strong>.
              </>,
            ])}
            {H2('Keeping the queue clean')}
            {UL([
              <>
                Improve the agent&rsquo;s knowledge URL to cut
                recurring questions ending up here.
              </>,
              <>
                Set the confidence threshold under{' '}
                <strong>Agent → Review</strong>.
              </>,
            ])}
            {Related([
              [
                'automation-and-flows',
                'autonomous-agents-overview',
                'Autonomous agents overview',
              ],
            ] as const)}
          </>
        ),
      },
    ],
  },
  // -------------------------------------------------------------------------
  // Analytics and deliverability
  // -------------------------------------------------------------------------
  {
    slug: 'analytics-and-deliverability',
    title: 'Analytics and deliverability',
    description:
      'Read every report inside Analytics, score your deliverability, and export when you need to.',
    icon: '📊',
    articles: [
      {
        slug: 'overview-tab',
        title: 'Reading the Overview tab',
        summary:
          'The 30-second answer to "how is marketing doing this week?".',
        minutes: 3,
        body: (
          <>
            {P(
              'The Overview tab (sidebar → Analytics → Overview) is the roll-up. Four KPI tiles up top, a 30-day send chart, a top-campaigns table, and an agent snapshot.',
            )}
            {H2('What the tiles mean')}
            {UL([
              <>
                <strong>Contacts</strong> — total non-suppressed contacts. Delta
                vs prior 30d.
              </>,
              <>
                <strong>Campaigns sent</strong> — count of campaigns with
                status SENT in the last 30d.
              </>,
              <>
                <strong>Avg open rate</strong> — email + WhatsApp read
                rate weighted by send volume.
              </>,
              <>
                <strong>Avg click rate</strong> — same, but for first
                clicks.
              </>,
            ])}
            {Tip(
              <>
                Each tile shows the delta against the previous same-length
                period. A green arrow is up, red is down — no colour
                means the delta was &lt; 1%.
              </>,
            )}
            {Related([
              [
                'analytics-and-deliverability',
                'email-metrics-explained',
                'Email metrics explained',
              ],
              [
                'analytics-and-deliverability',
                'deliverability-scoring',
                'Deliverability scoring',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'email-metrics-explained',
        title: 'Email campaign metrics explained',
        summary:
          'Delivered, open, click, unsub, complaint — and the one that actually predicts revenue.',
        minutes: 4,
        body: (
          <>
            {P(
              'Email metrics are everywhere, but a few are load-bearing. Here&rsquo;s what each means and the one you should actually watch.',
            )}
            {H2('The metrics')}
            {UL([
              <>
                <strong>Delivered</strong> — accepted by the destination
                MTA. Sent − bounces.
              </>,
              <>
                <strong>Open rate</strong> — pixel loaded. Noisy post
                Apple Mail Privacy; still trending-useful.
              </>,
              <>
                <strong>Click rate</strong> — clicked any tracked link.
                The signal that predicts revenue.
              </>,
              <>
                <strong>Unsub rate</strong> — target &lt; 0.5%. Over 1%
                means you&rsquo;re pestering.
              </>,
              <>
                <strong>Complaint rate</strong> — hit the spam button.
                Over 0.1% and ISPs will start filtering you globally.
              </>,
            ])}
            {Warn(
              <>
                Click rate &gt; open rate means Apple MPP is inflating
                opens — ignore the open rate and watch clicks.
              </>,
            )}
            {Related([
              [
                'analytics-and-deliverability',
                'bounces-complaints-unsubs',
                'Bounces, complaints, and unsubs',
              ],
              [
                'analytics-and-deliverability',
                'deliverability-scoring',
                'Deliverability scoring',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'whatsapp-funnel-metrics',
        title: 'WhatsApp funnel metrics explained',
        summary:
          'Sent → Delivered → Read → Replied → Clicked. What each means and when to worry.',
        minutes: 3,
        body: (
          <>
            {P(
              'The WhatsApp campaign tab shows a funnel chart plus a per-campaign table. Each step is a different Meta webhook event.',
            )}
            {H2('Steps')}
            {UL([
              <>
                <strong>Sent</strong> — Getyn handed the message to Meta.
              </>,
              <>
                <strong>Delivered</strong> — Meta confirms the message
                reached the handset.
              </>,
              <>
                <strong>Read</strong> — only if the recipient has read
                receipts on; typically 40–70% of delivered.
              </>,
              <>
                <strong>Replied</strong> — any inbound within the
                service window.
              </>,
              <>
                <strong>Clicked</strong> — URL button or quick-reply
                button taps, broken out per button.
              </>,
            ])}
            {H2('What&rsquo;s healthy')}
            {UL([
              <>Delivered / Sent &gt; 95%. Below that, check number quality.</>,
              <>Read / Delivered &gt; 60% is strong for marketing.</>,
              <>Replied / Delivered &gt; 5% is strong engagement.</>,
            ])}
            {Related([
              [
                'whatsapp-campaigns',
                'measure-whatsapp-results',
                'Measure WhatsApp campaign results',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'sms-delivery-analytics',
        title: 'SMS delivery analytics',
        summary:
          'Segment counts, delivery rate, failure codes — and what each code means.',
        minutes: 3,
        body: (
          <>
            {P(
              'The SMS tab shows per-campaign send counts, a delivery funnel, and a breakdown of failures by Twilio error code so you can triage fast.',
            )}
            {H2('Headline numbers')}
            {UL([
              <>
                <strong>Segments sent</strong> — billable count. Not the
                same as &ldquo;messages composed&rdquo; (see UCS-2 trap).
              </>,
              <>
                <strong>Delivered %</strong> — DELIVERED / SENT. &lt; 95%
                merits investigation.
              </>,
              <>
                <strong>Top failure codes</strong> — most common Twilio
                error codes with human-readable descriptions.
              </>,
            ])}
            {Related([
              [
                'sms-campaigns',
                'measure-sms-delivery',
                'Measure SMS delivery',
              ],
              [
                'sms-campaigns',
                'understand-sms-segments',
                'Understanding SMS segments',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'audience-growth',
        title: 'Audience growth over time',
        summary:
          'Watch net adds, segment movement, and growth-rate health.',
        minutes: 3,
        body: (
          <>
            {P(
              'The Audience tab (Analytics → Audience) answers &ldquo;is my list growing?&rdquo; and &ldquo;where are new contacts coming from?&rdquo;',
            )}
            {H2('Charts')}
            {UL([
              <>
                <strong>Contact growth</strong> — cumulative line over 90
                days. Breaks trend changes out visibly.
              </>,
              <>
                <strong>Daily net adds</strong> — adds minus suppressions.
                Negative days mean you&rsquo;re churning faster than
                acquiring.
              </>,
              <>
                <strong>Segment movement</strong> — which segments grew
                or shrunk last period.
              </>,
            ])}
            {Related([
              [
                'analytics-and-deliverability',
                'bounces-complaints-unsubs',
                'Bounces, complaints, and unsubs',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'bounces-complaints-unsubs',
        title: 'Bounces, complaints, and unsubs',
        summary:
          'The three metrics mailbox providers judge you on.',
        minutes: 3,
        body: (
          <>
            {P(
              'ISPs use these three signals above all others to decide where your mail lands. Getyn surfaces them per-campaign and workspace-wide.',
            )}
            {H2('Definitions')}
            {UL([
              <>
                <strong>Hard bounce</strong> — mailbox doesn&rsquo;t
                exist. Getyn permanently suppresses.
              </>,
              <>
                <strong>Soft bounce</strong> — temporary (full mailbox,
                greylisting). Retried once, then suppressed if persistent.
              </>,
              <>
                <strong>Complaint</strong> — recipient hit &ldquo;Mark as
                spam&rdquo;. Immediate suppression.
              </>,
              <>
                <strong>Unsub</strong> — recipient clicked unsubscribe.
                Clean exit.
              </>,
            ])}
            {H2('Where')}
            {UL([
              <>Per campaign — the campaign detail page.</>,
              <>
                Workspace-wide — <strong>Analytics → Deliverability</strong>.
              </>,
            ])}
            {Related([
              [
                'analytics-and-deliverability',
                'deliverability-scoring',
                'Deliverability scoring',
              ],
              [
                'contacts-and-segments',
                'suppression-list',
                'The suppression list',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'deliverability-scoring',
        title: 'Deliverability scoring',
        summary:
          'How Getyn turns your bounce / complaint / unsub rates into a single health number.',
        minutes: 3,
        body: (
          <>
            {P(
              'The Deliverability tab shows a composite score from 0–100. A quick signal that something&rsquo;s drifting before you look at the underlying numbers.',
            )}
            {H2('How it&rsquo;s computed')}
            {UL([
              <>Hard bounce rate &gt; 2%: heavy penalty.</>,
              <>Complaint rate &gt; 0.1%: heavy penalty.</>,
              <>Unsub rate &gt; 1%: moderate penalty.</>,
              <>Domain unverified: small penalty.</>,
            ])}
            {H2('Ranges')}
            {UL([
              <>
                <strong>90–100</strong> — healthy. Keep doing what
                you&rsquo;re doing.
              </>,
              <>
                <strong>70–89</strong> — watchable. Review the worst
                recent campaign.
              </>,
              <>
                <strong>&lt; 70</strong> — act now. One more bad send
                will hurt long-term reputation.
              </>,
            ])}
            {Related([
              [
                'getting-started',
                'verify-sending-domain',
                'Verify your sending domain',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'exporting-reports',
        title: 'Exporting reports',
        summary:
          'CSV export for every analytics table — for QBRs, boards, or just a deeper slice.',
        minutes: 2,
        body: (
          <>
            {P(
              'Every Analytics table has an Export button at the top-right. Exports run as a background job and arrive in your notification bell when ready.',
            )}
            {H2('Formats')}
            {UL([
              <>
                <strong>CSV</strong> — default; opens in anything.
              </>,
              <>
                <strong>JSON</strong> — if you prefer piping to a
                notebook.
              </>,
            ])}
            {Tip(
              <>
                Large exports (&gt; 50k rows) are chunked into multiple
                files and delivered as a zip.
              </>,
            )}
            {Related([
              [
                'analytics-and-deliverability',
                'overview-tab',
                'Reading the Overview tab',
              ],
            ] as const)}
          </>
        ),
      },
    ],
  },
  // -------------------------------------------------------------------------
  // Billing and plans
  // -------------------------------------------------------------------------
  {
    slug: 'billing-and-plans',
    title: 'Billing and plans',
    description:
      'The single-plan model, extras, upgrades, trials, and how Getyn bills you via xPay.',
    icon: '💳',
    articles: [
      {
        slug: 'single-plan-model',
        title: 'Understanding the single-plan pricing model',
        summary:
          'One base plan + usage-bundle extras — no tier jumping.',
        minutes: 3,
        body: (
          <>
            {P(
              'Getyn Campaigns runs on a single-plan model. Everyone starts on the same base plan; you add usage bundles (email volume, WhatsApp, SMS, AI credits) for what you actually use.',
            )}
            {H2('What comes with the base plan')}
            {UL([
              <>Unlimited email campaigns (volume-metered separately).</>,
              <>WhatsApp Business + Autonomous agents.</>,
              <>All automation & drip features.</>,
              <>Analytics + deliverability tools.</>,
              <>24×5 support.</>,
            ])}
            {H2('What&rsquo;s metered')}
            {UL([
              <>Marketing emails / month.</>,
              <>WhatsApp messages / month.</>,
              <>SMS segments / month.</>,
              <>AI credits / month.</>,
              <>Contacts total.</>,
              <>User seats.</>,
            ])}
            {Tip(
              <>
                No feature-gating between tiers. Every workspace can use
                every feature from day one; you pay for the volume you
                consume.
              </>,
            )}
            {Related([
              [
                'billing-and-plans',
                'buy-extra-bundles',
                'Buy extra AI credits, WhatsApp, or SMS bundles',
              ],
              [
                'billing-and-plans',
                'upgrade-your-plan',
                'Upgrade your plan',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'buy-extra-bundles',
        title: 'Buy extra AI credits, WhatsApp, or SMS bundles',
        summary:
          'Bundles are additive — you keep your base allowance and stack extras.',
        minutes: 3,
        body: (
          <>
            {P(
              'Extras attach to your subscription. One bundle of AI credits adds 100 credits / month on top of the base; same pattern for WhatsApp and SMS. Yearly plans multiply bundles × 12 and apply the yearly discount.',
            )}
            {H2('From the Upgrade modal')}
            {OL([
              <>
                Go to <strong>Settings → Subscription → Upgrade</strong>.
              </>,
              <>
                Drag each slider: AI credits (× 100), WhatsApp (× 100),
                SMS (× 100).
              </>,
              <>
                Total updates live. Toggle{' '}
                <strong>Monthly / Annual</strong> to see annual with the
                10% discount.
              </>,
              <>
                Click <strong>Upgrade now</strong> → xPay checkout.
              </>,
            ])}
            {H2('From the /pricing page')}
            {UL([
              <>
                Same sliders are also on the public pricing page so
                prospects see the real total before signing up.
              </>,
            ])}
            {Warn(
              <>
                Bundles land on your next billing cycle, OR instantly if
                you paid for an upgrade mid-cycle. The{' '}
                <code>provision-order-extras</code> worker handles both.
              </>,
            )}
            {Related([
              [
                'billing-and-plans',
                'upgrade-your-plan',
                'Upgrade your plan',
              ],
              [
                'billing-and-plans',
                'how-xpay-checkout-works',
                'How xPay checkout works',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'upgrade-your-plan',
        title: 'Upgrade your plan',
        summary:
          'Self-serve, xPay-backed, live in seconds — no sales call needed.',
        minutes: 3,
        body: (
          <>
            {P(
              'Upgrades are fully self-serve. The Upgrade button in Settings → Subscription opens a modal with sliders for every metered resource and a live total.',
            )}
            {H2('Flow')}
            {OL([
              <>Open Settings → Subscription. Click Upgrade.</>,
              <>Pick bundle sizes + billing cycle.</>,
              <>
                Click <strong>Upgrade now</strong> → xPay checkout
                (opens in a new tab).
              </>,
              <>
                On successful payment, Getyn calls the{' '}
                <code>provision-order-extras</code> worker, which applies
                TenantLimitOverride rows for your new limits. New caps
                are live within a second of PAID.
              </>,
              <>
                A <strong>Plan upgraded</strong> notification fires in
                the bell.
              </>,
            ])}
            {Related([
              [
                'billing-and-plans',
                'buy-extra-bundles',
                'Buy extra AI credits, WhatsApp, or SMS bundles',
              ],
              [
                'billing-and-plans',
                'trial-lifecycle',
                'Trial lifecycle and what happens when it ends',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'trial-lifecycle',
        title: 'Trial lifecycle and what happens when it ends',
        summary:
          'The 14-day trial, the warning bar, and what you have to do before day 14.',
        minutes: 3,
        body: (
          <>
            {P(
              'New workspaces start in a 14-day trial. Full feature access, capped volumes. The trial bar at the top shows days remaining and an Upgrade button.',
            )}
            {H2('What&rsquo;s capped during trial')}
            {UL([
              <>Email sends / day (5 by default).</>,
              <>WhatsApp sends / day.</>,
              <>AI credits (included at trial-limit).</>,
            ])}
            {H2('What happens on day 14')}
            {UL([
              <>
                <strong>Upgraded</strong> → you&rsquo;re on the paid
                plan; caps lift.
              </>,
              <>
                <strong>Not upgraded</strong> → workspace enters{' '}
                <strong>PAST DUE</strong>. Sends pause; UI stays
                readable.
              </>,
              <>
                A nightly <code>xpay-sync</code> cron reconciles trial
                → paid / expired based on xPay status.
              </>,
            ])}
            {Related([
              [
                'billing-and-plans',
                'upgrade-your-plan',
                'Upgrade your plan',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'invoices-and-history',
        title: 'Invoices and billing history',
        summary:
          'Where to find every PDF invoice Getyn has ever sent you.',
        minutes: 2,
        body: (
          <>
            {P(
              'All invoices live under Settings → Billing. Each row carries a PDF link, amount, date, and status (paid, pending, refunded).',
            )}
            {H2('Download')}
            {UL([
              <>Click the PDF icon next to any row to download.</>,
              <>
                The PDF is auto-generated at paid-status time. Changes
                to your billing address are prospective only — old
                invoices keep the old address.
              </>,
            ])}
            {Tip(
              <>
                Need a VAT number or purchase order on invoices? Set
                them under <strong>Settings → Workspace → Billing details</strong>{' '}
                before your next cycle.
              </>,
            )}
            {Related([
              [
                'billing-and-plans',
                'change-payment-method',
                'Change your payment method',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'change-payment-method',
        title: 'Change your payment method',
        summary:
          'Add a new card or switch to a different one — the next renewal uses whatever is current.',
        minutes: 2,
        body: (
          <>
            {P(
              'Getyn never stores raw card data — xPay tokenises everything. Updating your card updates the xPay vault, which the next renewal pulls from.',
            )}
            {H2('Update')}
            {OL([
              <>Open Settings → Billing.</>,
              <>
                Click <strong>Update card</strong>. An xPay dialog opens.
              </>,
              <>
                Enter new card details. On success the row flips to{' '}
                <strong>Active</strong>, the old row to{' '}
                <strong>Previous</strong>.
              </>,
            ])}
            {Warn(
              <>
                Your next renewal attempt uses the Active card. If it
                declines, we retry three times and email you on the
                third failure.
              </>,
            )}
            {Related([
              [
                'billing-and-plans',
                'invoices-and-history',
                'Invoices and billing history',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'plan-limits-usage',
        title: 'Plan limits and usage counters',
        summary:
          'Where to read live counters for every metered resource.',
        minutes: 2,
        body: (
          <>
            {P(
              'Live usage counters sit in two places: the topbar chips (emails, AI credits) and Settings → Subscription (full breakdown).',
            )}
            {H2('Where')}
            {UL([
              <>
                <strong>Topbar</strong> — emails / mo and AI credits
                this-month usage at a glance.
              </>,
              <>
                <strong>Settings → Subscription</strong> — bars for
                every meter including WhatsApp, SMS, contacts, seats.
              </>,
            ])}
            {H2('What happens at the cap')}
            {UL([
              <>
                Sends over the cap are refused with a clear error
                (&ldquo;Exceeds this month&rsquo;s SMS allowance&rdquo;).
              </>,
              <>
                A notification fires when you cross 80% of any meter so
                you can plan the upgrade before the wall.
              </>,
            ])}
            {Related([
              [
                'billing-and-plans',
                'upgrade-your-plan',
                'Upgrade your plan',
              ],
            ] as const)}
          </>
        ),
      },
      {
        slug: 'how-xpay-checkout-works',
        title: 'How xPay checkout works',
        summary:
          'The payment flow that powers trials, upgrades, extras, and number purchases.',
        minutes: 3,
        body: (
          <>
            {P(
              'xPay is the payment gateway behind every billed action in Getyn — new subscriptions, upgrades, number purchases. The flow is identical: start an order, redirect to xPay, pay, Getyn provisions on PAID webhook.',
            )}
            {H2('Order lifecycle')}
            {OL([
              <>
                You click a Buy / Upgrade / Purchase button.
              </>,
              <>
                Getyn creates a <code>CheckoutOrder</code> with a{' '}
                <code>method</code> like <code>xpay_upgrade</code> or{' '}
                <code>twilio_number_purchase</code>.
              </>,
              <>
                A new tab opens on xPay. You pay — card, netbanking, UPI.
              </>,
              <>
                xPay fires a webhook to Getyn with status = PAID.
              </>,
              <>
                Getyn runs the method-specific provisioner (apply
                limits, buy number, flip subscription to active).
              </>,
              <>Notification fires. UI refreshes on next focus.</>,
            ])}
            {H2('Why webhook + provisioner')}
            {UL([
              <>
                User may close the browser tab mid-pay — the webhook is
                the source of truth.
              </>,
              <>
                Provisioners are idempotent — if the webhook fires
                twice (xPay retries) you still get exactly one bundle.
              </>,
            ])}
            {Related([
              [
                'billing-and-plans',
                'buy-extra-bundles',
                'Buy extra AI credits, WhatsApp, or SMS bundles',
              ],
              [
                'sms-campaigns',
                'buy-a-phone-number',
                'Buy a phone number',
              ],
            ] as const)}
          </>
        ),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function findCategory(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

export function findArticle(
  categorySlug: string,
  articleSlug: string,
): { category: Category; article: Article } | undefined {
  const category = findCategory(categorySlug);
  if (!category) return undefined;
  const article = category.articles.find((a) => a.slug === articleSlug);
  if (!article) return undefined;
  return { category, article };
}

export function allArticlePaths(): Array<{
  categorySlug: string;
  articleSlug: string;
}> {
  return categories.flatMap((c) =>
    c.articles.map((a) => ({ categorySlug: c.slug, articleSlug: a.slug })),
  );
}

/** Flat searchable index — fed into the client DocsSearch component.
 *  Built once at module load; small enough that recomputation cost is
 *  trivial even if we add hundreds of articles. */
export function buildSearchIndex(): Array<{
  href: string;
  categoryTitle: string;
  articleTitle: string;
  summary: string;
  haystack: string;
}> {
  const out: Array<{
    href: string;
    categoryTitle: string;
    articleTitle: string;
    summary: string;
    haystack: string;
  }> = [];
  for (const c of categories) {
    for (const a of c.articles) {
      out.push({
        href: `/docs/${c.slug}/${a.slug}`,
        categoryTitle: c.title,
        articleTitle: a.title,
        summary: a.summary,
        haystack:
          `${a.title} ${a.summary} ${c.title}`.toLowerCase(),
      });
    }
  }
  return out;
}
