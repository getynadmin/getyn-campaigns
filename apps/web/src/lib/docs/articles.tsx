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
  <h2 className="mt-10 scroll-mt-24 font-display text-xl font-semibold tracking-tight">
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
