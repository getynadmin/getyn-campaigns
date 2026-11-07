/**
 * Emit INSERT ... ON CONFLICT statements for ~25 additional system
 * email templates spanning every category. Each shares the same
 * single-HTML-block Unlayer design shape used by the AI generator so
 * the editor opens them cleanly.
 */

type Tpl = {
  key: string;
  name: string;
  description: string;
  category:
    | 'WELCOME'
    | 'NEWSLETTER'
    | 'PROMOTIONAL'
    | 'ANNOUNCEMENT'
    | 'EVENT'
    | 'TRANSACTIONAL'
    | 'LAYOUT'
    | 'OTHER';
  html: string;
};

const panel = (hero: string, body: string): string => `
<div style="background:#f4f4f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <tr><td>
      ${hero}
      <div style="padding:28px 32px 36px;color:#111;line-height:1.6;font-size:15px;">
        ${body}
      </div>
    </td></tr>
  </table>
</div>`;

const btn = (label: string, color: string): string =>
  `<a href="#" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${label}</a>`;

const heroImg = (url: string, alt: string): string =>
  `<img src="${url}" alt="${alt}" style="display:block;width:100%;height:220px;object-fit:cover;"/>`;

const templates: Tpl[] = [
  // WELCOME
  {
    key: 'welcome-onboarding-steps',
    name: 'Onboarding — next steps',
    description: 'Welcome with a 3-step checklist and CTA.',
    category: 'WELCOME',
    html: panel(
      `<div style="background:#eff6ff;padding:36px 32px;"><p style="margin:0;color:#1e40af;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Getting started</p><h1 style="margin:8px 0 0;color:#1e3a8a;font-size:26px;font-weight:700;">Let's set you up, {{first_name}}</h1></div>`,
      `<p>Three quick steps will get you to your first win.</p>
       <ol style="padding-left:20px;margin:16px 0;color:#334155;">
         <li style="margin-bottom:8px;">Connect your data source</li>
         <li style="margin-bottom:8px;">Invite a teammate to collaborate</li>
         <li style="margin-bottom:8px;">Run your first automation</li>
       </ol>
       <p style="text-align:center;margin-top:28px;">${btn('Continue setup', '#1d4ed8')}</p>`,
    ),
  },
  {
    key: 'welcome-personal-note',
    name: 'Welcome — personal note',
    description: 'Short, warm hello from the founder.',
    category: 'WELCOME',
    html: panel(
      `<div style="padding:32px 32px 8px;"><h1 style="margin:0;color:#0f172a;font-size:24px;font-weight:700;">Hey {{first_name}} 👋</h1></div>`,
      `<p>I'm so glad you signed up — welcome to {{tenantName}}.</p>
       <p>I started this because I kept running into the same problem and couldn't find a tool that got it right. If you ever hit a wall, reply to this email — it comes to me.</p>
       <p style="margin-top:24px;color:#334155;">— The team at {{tenantName}}</p>
       <p style="text-align:center;margin-top:28px;">${btn('Open my workspace', '#0f172a')}</p>`,
    ),
  },
  // NEWSLETTER
  {
    key: 'newsletter-product-digest',
    name: 'Product digest',
    description: 'Monthly roundup of shipped features and tips.',
    category: 'NEWSLETTER',
    html: panel(
      heroImg('https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&q=80', 'Workspace'),
      `<p style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 6px;">Issue #12 · November</p>
       <h1 style="margin:0 0 16px;color:#0f172a;font-size:24px;font-weight:700;">What shipped this month</h1>
       <div style="padding:14px 0;border-bottom:1px solid #e5e7eb;"><strong style="color:#0f172a;">✨ Faster bulk actions.</strong> <span style="color:#475569;">Edit 10,000 contacts in under a second.</span></div>
       <div style="padding:14px 0;border-bottom:1px solid #e5e7eb;"><strong style="color:#0f172a;">📊 New analytics tab.</strong> <span style="color:#475569;">Heatmaps and cohort views are live.</span></div>
       <div style="padding:14px 0;"><strong style="color:#0f172a;">🤖 Smarter suggestions.</strong> <span style="color:#475569;">Draft replies now one click away.</span></div>
       <p style="text-align:center;margin-top:24px;">${btn('Read the changelog', '#0ea5e9')}</p>`,
    ),
  },
  {
    key: 'newsletter-community-roundup',
    name: 'Community roundup',
    description: 'Highlights from the community this week.',
    category: 'NEWSLETTER',
    html: panel(
      `<div style="background:#fdf4ff;padding:36px 32px;"><p style="margin:0;color:#a21caf;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">From the community</p><h1 style="margin:8px 0 0;color:#701a75;font-size:26px;font-weight:700;">Three stories worth your time</h1></div>`,
      `<ul style="list-style:none;padding:0;margin:0;">
         <li style="padding:16px;background:#faf5ff;border-radius:8px;margin-bottom:12px;"><strong>How one team cut churn 40%</strong><br/><span style="color:#64748b;">A step-by-step teardown of their retention playbook.</span></li>
         <li style="padding:16px;background:#faf5ff;border-radius:8px;margin-bottom:12px;"><strong>The template library we all missed</strong><br/><span style="color:#64748b;">A thread of favourites from your peers.</span></li>
         <li style="padding:16px;background:#faf5ff;border-radius:8px;"><strong>What the pros do differently</strong><br/><span style="color:#64748b;">Patterns we see across top senders.</span></li>
       </ul>
       <p style="text-align:center;margin-top:28px;">${btn('Browse all posts', '#a21caf')}</p>`,
    ),
  },
  // PROMOTIONAL
  {
    key: 'promo-flash-sale',
    name: 'Flash sale — 24h',
    description: 'High-urgency flash sale with countdown vibe.',
    category: 'PROMOTIONAL',
    html: panel(
      `<div style="background:#dc2626;padding:40px 32px;text-align:center;"><p style="margin:0;color:#fee2e2;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">24 hours only</p><h1 style="margin:8px 0 0;color:#fff;font-size:38px;font-weight:800;letter-spacing:-0.02em;">FLASH SALE</h1><p style="margin:8px 0 0;color:#fecaca;font-size:14px;">Ends tonight at midnight</p></div>`,
      `<p style="text-align:center;font-size:18px;color:#0f172a;margin:0 0 20px;"><strong>30% off everything</strong></p>
       <div style="margin:0 0 24px;padding:18px;background:#fef2f2;border:2px dashed #dc2626;border-radius:8px;text-align:center;">
         <p style="margin:0;color:#991b1b;font-family:monospace;font-size:24px;font-weight:700;letter-spacing:0.08em;">FLASH30</p>
       </div>
       <p style="text-align:center;">${btn('Shop now →', '#dc2626')}</p>
       <p style="color:#6b7280;font-size:11px;text-align:center;margin-top:20px;">Code auto-applies at checkout. Expires at 11:59 PM tonight.</p>`,
    ),
  },
  {
    key: 'promo-loyalty-reward',
    name: 'Loyalty reward',
    description: 'Thank-you reward for long-term customers.',
    category: 'PROMOTIONAL',
    html: panel(
      `<div style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:40px 32px;text-align:center;"><div style="display:inline-block;width:56px;height:56px;background:#fff;border-radius:50%;line-height:56px;font-size:28px;">🎁</div><h1 style="margin:16px 0 0;color:#fff;font-size:26px;font-weight:700;">A gift from us to you</h1></div>`,
      `<p>Hi {{first_name}},</p>
       <p>You've been with {{tenantName}} for a while now and we wanted to say thank you. Here's a little something.</p>
       <div style="margin:20px 0;padding:24px;background:#fff7ed;border-radius:10px;text-align:center;">
         <p style="margin:0 0 6px;font-size:12px;color:#92400e;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Your reward</p>
         <p style="margin:0;font-size:22px;color:#78350f;font-weight:700;">$25 credit on your next order</p>
       </div>
       <p style="text-align:center;">${btn('Claim it', '#d97706')}</p>`,
    ),
  },
  {
    key: 'promo-bundle-deal',
    name: 'Bundle deal',
    description: 'Multi-item bundle with price stack.',
    category: 'PROMOTIONAL',
    html: panel(
      `<div style="background:#064e3b;padding:36px 32px;text-align:center;"><p style="margin:0;color:#6ee7b7;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">Bundle & save</p><h1 style="margin:8px 0 0;color:#fff;font-size:26px;font-weight:700;">Three essentials, one price</h1></div>`,
      `<p>Hand-picked tools that work beautifully together.</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
         <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">Core subscription <span style="color:#6b7280;">(1 yr)</span></td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;"><s>$199</s></td></tr>
         <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">Analytics add-on</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;"><s>$99</s></td></tr>
         <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">Priority support</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;"><s>$49</s></td></tr>
         <tr><td style="padding:14px 0;color:#065f46;font-weight:700;">Bundle price</td><td style="padding:14px 0;text-align:right;color:#065f46;font-weight:700;">$249</td></tr>
       </table>
       <p style="text-align:center;">${btn('Get the bundle', '#065f46')}</p>`,
    ),
  },
  {
    key: 'promo-early-bird',
    name: 'Early-bird pricing',
    description: 'Limited-slot early-bird offer.',
    category: 'PROMOTIONAL',
    html: panel(
      `<div style="background:#fef3c7;padding:36px 32px;text-align:center;"><p style="margin:0;color:#92400e;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">Early access</p><h1 style="margin:8px 0 0;color:#78350f;font-size:26px;font-weight:700;">First 100 customers, 40% off</h1></div>`,
      `<p>We're opening the doors. Lock in founding-member pricing before it expires.</p>
       <div style="margin:24px 0;padding:20px;background:#fffbeb;border-radius:10px;">
         <p style="margin:0 0 6px;color:#78350f;font-weight:700;">Founder plan</p>
         <p style="margin:0;color:#111;"><span style="font-size:28px;font-weight:800;">$12</span><span style="color:#64748b;"> / mo for life</span></p>
       </div>
       <p style="text-align:center;">${btn('Grab a spot', '#92400e')}</p>`,
    ),
  },
  // ANNOUNCEMENT
  {
    key: 'announce-pricing-change',
    name: 'Pricing change',
    description: 'Transparent pricing update with rationale.',
    category: 'ANNOUNCEMENT',
    html: panel(
      `<div style="padding:32px 32px 16px;border-bottom:3px solid #0f172a;"><h1 style="margin:0;color:#0f172a;font-size:26px;font-weight:700;">An update on pricing</h1></div>`,
      `<p>Hi {{first_name}},</p>
       <p>Starting Jan 1, our Pro plan will go from $29 to $39/month. Existing customers keep their current rate for 12 months — no action needed.</p>
       <p style="margin-top:20px;font-weight:600;">Why?</p>
       <p>We shipped three major features this year and want to keep investing. The new price supports ongoing work on reliability, reporting, and support SLA.</p>
       <p style="text-align:center;margin-top:28px;">${btn('Read the full rationale', '#0f172a')}</p>`,
    ),
  },
  {
    key: 'announce-partnership',
    name: 'Partnership announcement',
    description: 'Joint announcement with another brand.',
    category: 'ANNOUNCEMENT',
    html: panel(
      `<div style="background:#f1f5f9;padding:36px 32px;text-align:center;"><p style="margin:0;color:#334155;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">Better together</p><h1 style="margin:12px 0 0;color:#0f172a;font-size:24px;font-weight:700;">{{tenantName}} × Partner Co.</h1></div>`,
      `<p>Big news — we're teaming up with Partner Co. to bring you a native integration launching next week.</p>
       <p>If you use both tools today, this means one-click data sync, unified reporting, and single sign-on.</p>
       <p style="text-align:center;margin-top:28px;">${btn('See what\'s coming', '#0f172a')}</p>`,
    ),
  },
  {
    key: 'announce-maintenance',
    name: 'Scheduled maintenance',
    description: 'Service maintenance window notice.',
    category: 'ANNOUNCEMENT',
    html: panel(
      `<div style="background:#fffbeb;padding:28px 32px;border-left:4px solid #f59e0b;"><p style="margin:0;color:#92400e;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Service notice</p><h1 style="margin:8px 0 0;color:#78350f;font-size:22px;font-weight:700;">Scheduled maintenance this Sunday</h1></div>`,
      `<p>We'll be rolling out infrastructure upgrades this weekend. Here are the details:</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
         <tr><td style="padding:10px 0;color:#64748b;">Window</td><td style="padding:10px 0;color:#0f172a;font-weight:600;">Sun 2:00–4:00 AM UTC</td></tr>
         <tr><td style="padding:10px 0;color:#64748b;">Expected impact</td><td style="padding:10px 0;color:#0f172a;font-weight:600;">Brief read-only periods</td></tr>
         <tr><td style="padding:10px 0;color:#64748b;">Status page</td><td style="padding:10px 0;"><a href="#" style="color:#f59e0b;">status.example.com</a></td></tr>
       </table>
       <p style="color:#6b7280;font-size:13px;">We'll post live updates on the status page. Questions? Just reply.</p>`,
    ),
  },
  {
    key: 'announce-policy-update',
    name: 'Policy update',
    description: 'Terms or privacy policy change notice.',
    category: 'ANNOUNCEMENT',
    html: panel(
      `<div style="padding:32px 32px 16px;"><p style="margin:0;color:#64748b;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Policy update</p><h1 style="margin:8px 0 0;color:#0f172a;font-size:22px;font-weight:700;">Changes to our Terms of Service</h1></div>`,
      `<p>Effective December 15, we're updating our Terms of Service to reflect a few changes.</p>
       <p style="margin-top:16px;font-weight:600;">What changed</p>
       <ul style="margin:8px 0 20px 20px;padding:0;color:#334155;"><li>Updated data retention language</li><li>New clause on AI-assisted features</li><li>Clearer cancellation and refund terms</li></ul>
       <p style="text-align:center;margin-top:24px;">${btn('Read the full policy', '#0f172a')}</p>`,
    ),
  },
  // EVENT
  {
    key: 'event-webinar-invite',
    name: 'Webinar invite',
    description: 'Clean webinar RSVP with time/topic block.',
    category: 'EVENT',
    html: panel(
      heroImg('https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=1200&q=80', 'Webinar'),
      `<p style="margin:0 0 6px;color:#0ea5e9;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">Live webinar</p>
       <h1 style="margin:0 0 16px;color:#0f172a;font-size:24px;font-weight:700;">How top teams scale their email program</h1>
       <div style="background:#f0f9ff;border-radius:10px;padding:18px;margin:16px 0;">
         <p style="margin:0 0 4px;color:#0369a1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">When</p>
         <p style="margin:0 0 10px;color:#0f172a;font-weight:600;">Thursday · 2:00 PM ET · 45 min</p>
         <p style="margin:0 0 4px;color:#0369a1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Host</p>
         <p style="margin:0;color:#0f172a;font-weight:600;">Alex Rivera, Head of Lifecycle</p>
       </div>
       <p style="text-align:center;margin-top:24px;">${btn('Save my seat', '#0ea5e9')}</p>`,
    ),
  },
  {
    key: 'event-conference-invite',
    name: 'Conference invite',
    description: 'In-person conference announcement.',
    category: 'EVENT',
    html: panel(
      `<div style="background:#111827;padding:48px 32px;text-align:center;"><p style="margin:0;color:#fbbf24;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Save the date</p><h1 style="margin:10px 0 0;color:#fff;font-size:30px;font-weight:800;">Signal 2026</h1><p style="margin:10px 0 0;color:#9ca3af;">March 12-14 · San Francisco</p></div>`,
      `<p>Our annual conference is back — three days of talks, workshops, and hallway conversations with people pushing the craft forward.</p>
       <p><strong>Early-bird tickets</strong> are open now. Save 30% before Dec 1.</p>
       <p style="text-align:center;margin-top:28px;">${btn('Get your ticket', '#fbbf24')}</p>`,
    ),
  },
  {
    key: 'event-reminder',
    name: 'Event reminder — 24h',
    description: 'Day-before reminder with join link.',
    category: 'EVENT',
    html: panel(
      `<div style="background:#ecfeff;padding:32px;text-align:center;"><p style="margin:0;color:#0e7490;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Tomorrow</p><h1 style="margin:8px 0 0;color:#164e63;font-size:24px;font-weight:700;">See you in 24 hours</h1></div>`,
      `<p>Hi {{first_name}}, a quick reminder about tomorrow's session.</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f8fafc;border-radius:8px;">
         <tr><td style="padding:16px;"><strong>Growth tactics that still work in 2026</strong><br/><span style="color:#64748b;">Thu · 2:00 PM ET · 45 min</span></td></tr>
       </table>
       <p style="text-align:center;">${btn('Add to calendar', '#0891b2')}</p>
       <p style="color:#6b7280;font-size:13px;text-align:center;margin-top:12px;">Can't make it? <a href="#" style="color:#0891b2;">Get the recording</a>.</p>`,
    ),
  },
  // TRANSACTIONAL
  {
    key: 'tx-shipping-update',
    name: 'Shipping update',
    description: 'Order shipped with tracking link.',
    category: 'TRANSACTIONAL',
    html: panel(
      `<div style="padding:32px 32px 16px;border-bottom:1px solid #e5e7eb;"><p style="margin:0;color:#0ea5e9;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Shipped</p><h1 style="margin:6px 0 0;color:#0f172a;font-size:22px;font-weight:700;">Your order is on the way</h1></div>`,
      `<p>Hi {{first_name}}, your order #{{orderId}} shipped today.</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f8fafc;border-radius:8px;">
         <tr><td style="padding:16px;"><p style="margin:0 0 4px;color:#64748b;font-size:12px;">Tracking</p><p style="margin:0;color:#0f172a;font-family:monospace;font-weight:700;">TRK1234567890</p></td></tr>
       </table>
       <p style="text-align:center;">${btn('Track your package', '#0ea5e9')}</p>
       <p style="color:#6b7280;font-size:12px;margin-top:20px;">Expected arrival: 3-5 business days.</p>`,
    ),
  },
  {
    key: 'tx-password-reset',
    name: 'Password reset',
    description: 'Secure password reset with time-limited link.',
    category: 'TRANSACTIONAL',
    html: panel(
      `<div style="padding:32px 32px 16px;"><h1 style="margin:0;color:#0f172a;font-size:22px;font-weight:700;">Reset your password</h1></div>`,
      `<p>We got a request to reset the password for your {{tenantName}} account. If that was you, click below — the link is good for the next 30 minutes.</p>
       <p style="text-align:center;margin:24px 0;">${btn('Reset password', '#0f172a')}</p>
       <p style="color:#6b7280;font-size:12px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
    ),
  },
  {
    key: 'tx-account-verify',
    name: 'Verify your email',
    description: 'Email-verification with 6-digit code.',
    category: 'TRANSACTIONAL',
    html: panel(
      `<div style="padding:32px 32px 16px;text-align:center;"><h1 style="margin:0;color:#0f172a;font-size:22px;font-weight:700;">Confirm it's you</h1></div>`,
      `<p>Here's your verification code — paste it into the app to continue.</p>
       <div style="margin:24px 0;padding:24px;background:#f1f5f9;border-radius:10px;text-align:center;">
         <p style="margin:0;font-family:monospace;font-size:32px;font-weight:700;color:#0f172a;letter-spacing:0.15em;">482 913</p>
       </div>
       <p style="color:#6b7280;font-size:12px;text-align:center;">This code expires in 10 minutes. Didn't request it? You can safely ignore this email.</p>`,
    ),
  },
  {
    key: 'tx-invoice-paid',
    name: 'Invoice paid',
    description: 'Payment-received acknowledgement.',
    category: 'TRANSACTIONAL',
    html: panel(
      `<div style="padding:32px 32px 16px;border-bottom:1px solid #e5e7eb;"><p style="margin:0;color:#16a34a;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Payment received</p><h1 style="margin:6px 0 0;color:#0f172a;font-size:22px;font-weight:700;">Thanks — you're all set</h1></div>`,
      `<p>Your payment of <strong>$149.00</strong> for invoice #INV-2041 cleared today. Nothing more needed from you.</p>
       <p style="text-align:center;margin-top:24px;">${btn('Download invoice PDF', '#16a34a')}</p>`,
    ),
  },
  {
    key: 'tx-cancellation',
    name: 'Subscription cancelled',
    description: 'Cancellation confirmation with win-back.',
    category: 'TRANSACTIONAL',
    html: panel(
      `<div style="padding:32px 32px 16px;"><h1 style="margin:0;color:#0f172a;font-size:22px;font-weight:700;">Your subscription is cancelled</h1></div>`,
      `<p>Your {{tenantName}} subscription has been cancelled. You'll still have access until your current billing period ends on <strong>Dec 31</strong>.</p>
       <p style="margin-top:16px;">We'd love to know what we could have done better. If you have 30 seconds — <a href="#" style="color:#0f172a;">reply with one thing</a>.</p>
       <p style="text-align:center;margin-top:24px;">${btn('Reactivate anytime', '#0f172a')}</p>`,
    ),
  },
  // OTHER
  {
    key: 'feedback-survey',
    name: 'Feedback survey',
    description: 'Short post-purchase feedback request.',
    category: 'OTHER',
    html: panel(
      `<div style="padding:32px 32px 16px;"><h1 style="margin:0;color:#0f172a;font-size:22px;font-weight:700;">Mind if we ask one thing?</h1></div>`,
      `<p>Hi {{first_name}}, you've been using {{tenantName}} for about a month now. How's it going?</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>
         <td style="padding:0 4px;text-align:center;"><a href="#" style="display:block;padding:14px;background:#fee2e2;border-radius:8px;text-decoration:none;color:#991b1b;font-size:24px;">😞</a></td>
         <td style="padding:0 4px;text-align:center;"><a href="#" style="display:block;padding:14px;background:#fef3c7;border-radius:8px;text-decoration:none;color:#92400e;font-size:24px;">😐</a></td>
         <td style="padding:0 4px;text-align:center;"><a href="#" style="display:block;padding:14px;background:#dcfce7;border-radius:8px;text-decoration:none;color:#166534;font-size:24px;">🙂</a></td>
         <td style="padding:0 4px;text-align:center;"><a href="#" style="display:block;padding:14px;background:#d1fae5;border-radius:8px;text-decoration:none;color:#065f46;font-size:24px;">😍</a></td>
       </tr></table>
       <p style="color:#6b7280;font-size:13px;text-align:center;">One click. Takes two seconds.</p>`,
    ),
  },
  {
    key: 'testimonial-request',
    name: 'Testimonial request',
    description: 'Ask a happy customer for a review.',
    category: 'OTHER',
    html: panel(
      `<div style="padding:32px 32px 16px;"><h1 style="margin:0;color:#0f172a;font-size:22px;font-weight:700;">Would you share a quick note?</h1></div>`,
      `<p>Hi {{first_name}} — you've been with {{tenantName}} for a while and we're putting together our customer stories page.</p>
       <p>If you have 2 minutes, we'd love a short sentence about what's working for you. It helps others deciding whether we're the right fit.</p>
       <p style="text-align:center;margin-top:24px;">${btn('Share a quick note', '#0f172a')}</p>`,
    ),
  },
  {
    key: 'referral-invite',
    name: 'Referral invite',
    description: 'Invite a friend with reward on both sides.',
    category: 'OTHER',
    html: panel(
      `<div style="background:#ecfdf5;padding:36px 32px;text-align:center;"><div style="display:inline-block;width:56px;height:56px;background:#fff;border-radius:50%;line-height:56px;font-size:28px;">🤝</div><h1 style="margin:16px 0 0;color:#065f46;font-size:24px;font-weight:700;">Give $20, get $20</h1></div>`,
      `<p>Know someone who'd love {{tenantName}}? Share your link — they get $20 off, you get $20 credit when they sign up.</p>
       <div style="margin:20px 0;padding:14px;background:#f0fdf4;border:1px dashed #10b981;border-radius:8px;text-align:center;">
         <p style="margin:0;color:#065f46;font-family:monospace;font-size:14px;">getyn.co/r/{{first_name}}</p>
       </div>
       <p style="text-align:center;">${btn('Copy my link', '#10b981')}</p>`,
    ),
  },
  {
    key: 'milestone-celebration',
    name: 'Milestone celebration',
    description: 'Celebrate a user milestone with a thanks.',
    category: 'OTHER',
    html: panel(
      `<div style="background:linear-gradient(135deg,#8b5cf6 0%,#6366f1 100%);padding:40px 32px;text-align:center;"><p style="margin:0;color:#ddd6fe;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">You did it</p><h1 style="margin:10px 0 0;color:#fff;font-size:30px;font-weight:800;">1,000 contacts 🎉</h1></div>`,
      `<p>Hi {{first_name}}, we noticed you just crossed <strong>1,000 contacts</strong> in your {{tenantName}} workspace. That's a real milestone.</p>
       <p>Thanks for building here. Here's to the next 10,000.</p>
       <p style="text-align:center;margin-top:24px;">${btn('See your growth chart', '#7c3aed')}</p>`,
    ),
  },
  // LAYOUT
  {
    key: 'layout-image-left',
    name: 'Image + text',
    description: 'Image on top, copy and button below.',
    category: 'LAYOUT',
    html: panel(
      heroImg('https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80', 'Workspace'),
      `<h1 style="margin:0 0 12px;color:#0f172a;font-size:24px;font-weight:700;">Headline for the section</h1>
       <p style="color:#475569;line-height:1.65;">Supporting paragraph that sets up the image above. Use this layout for product shots, stock photography, or any image that benefits from full-width presentation.</p>
       <p style="text-align:center;margin-top:24px;">${btn('Call to action', '#0f172a')}</p>`,
    ),
  },
  {
    key: 'layout-centered-cta',
    name: 'Centered CTA',
    description: 'Minimal centered announcement with button.',
    category: 'LAYOUT',
    html: panel(
      `<div style="padding:48px 32px 24px;text-align:center;"><h1 style="margin:0 0 12px;color:#0f172a;font-size:30px;font-weight:800;letter-spacing:-0.02em;">A short, punchy headline</h1><p style="margin:0;color:#64748b;font-size:15px;">One line of context under the headline.</p></div>`,
      `<p style="text-align:center;">${btn('Primary action', '#0f172a')}</p>
       <p style="text-align:center;color:#6b7280;font-size:13px;margin-top:16px;">Secondary microcopy or disclaimer line.</p>`,
    ),
  },
  {
    key: 'layout-quote-card',
    name: 'Pull quote',
    description: 'Big customer quote with attribution.',
    category: 'LAYOUT',
    html: panel(
      `<div style="padding:40px 32px 16px;"><p style="margin:0;color:#94a3b8;font-size:40px;font-family:Georgia,serif;line-height:1;">"</p></div>`,
      `<p style="margin:0 0 20px;font-family:Georgia,serif;color:#0f172a;font-size:22px;line-height:1.5;">We cut our setup time in half within the first week. Would have paid 3x this to get the time back.</p>
       <p style="margin:0;color:#64748b;font-size:14px;">— Alex Rivera, Head of Growth at Example Co.</p>
       <p style="text-align:center;margin-top:28px;">${btn('Read the full story', '#0f172a')}</p>`,
    ),
  },
  {
    key: 'layout-stats-row',
    name: 'Stats row',
    description: 'Three KPI tiles in a row.',
    category: 'LAYOUT',
    html: panel(
      `<div style="padding:32px 32px 16px;"><h1 style="margin:0;color:#0f172a;font-size:22px;font-weight:700;text-align:center;">Your month at a glance</h1></div>`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr>
         <td style="padding:0 6px;text-align:center;"><div style="background:#f0f9ff;border-radius:10px;padding:18px;"><p style="margin:0;color:#0369a1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Sent</p><p style="margin:4px 0 0;color:#0c4a6e;font-size:24px;font-weight:800;">24,120</p></div></td>
         <td style="padding:0 6px;text-align:center;"><div style="background:#ecfdf5;border-radius:10px;padding:18px;"><p style="margin:0;color:#047857;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Opens</p><p style="margin:4px 0 0;color:#064e3b;font-size:24px;font-weight:800;">41%</p></div></td>
         <td style="padding:0 6px;text-align:center;"><div style="background:#fef3c7;border-radius:10px;padding:18px;"><p style="margin:0;color:#92400e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Clicks</p><p style="margin:4px 0 0;color:#78350f;font-size:24px;font-weight:800;">7.8%</p></div></td>
       </tr></table>
       <p style="text-align:center;margin-top:16px;">${btn('Open full report', '#0f172a')}</p>`,
    ),
  },
];

function wrap(html: string): object {
  return {
    counters: { u_column: 1, u_row: 1, u_content_html: 1 },
    body: {
      id: 'ai-body',
      rows: [
        {
          id: 'r1',
          cells: [1],
          columns: [
            {
              id: 'c1',
              contents: [
                {
                  id: 'h1',
                  type: 'html',
                  values: {
                    html,
                    containerPadding: '10px',
                    _meta: { htmlID: 'u_content_html_1', htmlClassNames: 'u_content_html' },
                  },
                },
              ],
              values: { _meta: { htmlID: 'u_column_1', htmlClassNames: 'u_column' } },
            },
          ],
          values: { padding: '0px', _meta: { htmlID: 'u_row_1', htmlClassNames: 'u_row' } },
        },
      ],
      values: {
        backgroundColor: '#ffffff',
        contentWidth: '600px',
        _meta: { htmlID: 'u_body', htmlClassNames: 'u_body' },
      },
    },
    schemaVersion: 6,
  };
}

for (const t of templates) {
  const id = `seed-tpl-${t.key}`;
  const design = wrap(t.html);
  const dj = JSON.stringify(design).replace(/'/g, "''");
  const name = t.name.replace(/'/g, "''");
  const desc = t.description.replace(/'/g, "''");
  console.log(
    `INSERT INTO "EmailTemplate" (id, "tenantId", name, description, category, "designJson", "isAiGenerated", "createdAt", "updatedAt") VALUES ('${id}', NULL, '${name}', '${desc}', '${t.category}', '${dj}'::jsonb, false, now(), now()) ON CONFLICT (id) DO UPDATE SET "designJson" = EXCLUDED."designJson", name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category, "updatedAt" = now();`,
  );
}
