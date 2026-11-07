/**
 * Rich HTML designs for the 7 system email templates. Rendered via
 * `wrapHtmlInUnlayerDesign` so the editor loads them as a single HTML
 * block the operator can split/edit. Shared with the seed (fresh
 * installs) and the backfill script (existing installs).
 */

export interface SystemTemplateSeed {
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
    | 'OTHER';
  bodyHtml: string;
}

const PANEL = (hero: string, body: string): string => `
<div style="background:#f4f4f7;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <tr><td>
      ${hero}
      <div style="padding:28px 32px 36px 32px;color:#111;line-height:1.6;font-size:15px;">
        ${body}
      </div>
    </td></tr>
  </table>
  <p style="max-width:600px;margin:16px auto 0;font-family:inherit;text-align:center;font-size:12px;color:#8a8a98;line-height:1.5;">
    You received this because you're subscribed to updates from {{tenantName}}.<br/>
    <a href="{{unsubscribeUrl}}" style="color:#8a8a98;text-decoration:underline;">Unsubscribe</a>
    &nbsp;·&nbsp;
    <a href="{{webViewUrl}}" style="color:#8a8a98;text-decoration:underline;">View in browser</a>
  </p>
</div>`;

const BUTTON = (label: string, href = '#', color = '#111'): string => `
<a href="${href}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${label}</a>`;

export const SYSTEM_TEMPLATE_SEEDS: SystemTemplateSeed[] = [
  {
    key: 'welcome',
    name: 'Welcome',
    description: 'Greet new contacts the moment they sign up.',
    category: 'WELCOME',
    bodyHtml: PANEL(
      `<div style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:48px 32px;text-align:center;">
        <div style="display:inline-block;width:56px;height:56px;background:#ffffff;border-radius:50%;line-height:56px;font-size:28px;">👋</div>
        <h1 style="margin:16px 0 0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.02em;">Welcome to {{tenantName}}</h1>
      </div>`,
      `<p>Hi {{first_name}},</p>
      <p>Thanks for joining us. You're in good company — thousands of teams use {{tenantName}} to stay connected with their customers.</p>
      <p style="margin:24px 0 8px;font-weight:600;">Three things to try first:</p>
      <ol style="margin:0 0 24px 20px;padding:0;">
        <li style="margin-bottom:6px;">Import your contacts</li>
        <li style="margin-bottom:6px;">Create your first campaign</li>
        <li style="margin-bottom:6px;">Invite a teammate</li>
      </ol>
      <p style="text-align:center;margin:32px 0 8px;">${BUTTON('Open the dashboard', '#', '#10b981')}</p>
      <p style="color:#6b7280;font-size:13px;margin-top:24px;">Questions? Just reply — a human reads every message.</p>`,
    ),
  },
  {
    key: 'newsletter',
    name: 'Newsletter',
    description: 'Monthly digest of product updates + community wins.',
    category: 'NEWSLETTER',
    bodyHtml: PANEL(
      `<div style="padding:32px 32px 16px 32px;border-bottom:3px solid #0ea5e9;">
        <p style="margin:0;color:#0ea5e9;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">The {{tenantName}} Monthly</p>
        <h1 style="margin:8px 0 0;color:#0f172a;font-size:26px;font-weight:700;letter-spacing:-0.02em;">This month's roundup</h1>
      </div>`,
      `<p>Hi {{first_name}}, three things worth your time this month 👇</p>
      <div style="margin:24px 0;padding:20px;background:#f8fafc;border-radius:8px;border-left:3px solid #0ea5e9;">
        <p style="margin:0 0 6px;font-weight:700;color:#0f172a;">🚀 What shipped</p>
        <p style="margin:0;color:#334155;font-size:14px;">Two major improvements that cut our send latency in half.</p>
      </div>
      <div style="margin:0 0 24px;padding:20px;background:#f8fafc;border-radius:8px;border-left:3px solid #10b981;">
        <p style="margin:0 0 6px;font-weight:700;color:#0f172a;">💡 Tip of the month</p>
        <p style="margin:0;color:#334155;font-size:14px;">How top teams organise their segments for high-performing campaigns.</p>
      </div>
      <div style="margin:0 0 32px;padding:20px;background:#f8fafc;border-radius:8px;border-left:3px solid #f59e0b;">
        <p style="margin:0 0 6px;font-weight:700;color:#0f172a;">🎙️ From the community</p>
        <p style="margin:0;color:#334155;font-size:14px;">A great thread on avoiding unsubscribes without softening your CTAs.</p>
      </div>
      <p style="text-align:center;">${BUTTON('Read the full digest', '#', '#0ea5e9')}</p>`,
    ),
  },
  {
    key: 'promotional_offer',
    name: 'Promotional offer',
    description: 'Limited-time discount with a clear call to action.',
    category: 'PROMOTIONAL',
    bodyHtml: PANEL(
      `<div style="background:#f59e0b;padding:40px 32px;text-align:center;">
        <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;opacity:0.9;">Limited time</p>
        <h1 style="margin:12px 0 0;color:#ffffff;font-size:34px;font-weight:800;letter-spacing:-0.02em;">20% off, this week only</h1>
      </div>`,
      `<p>Hi {{first_name}},</p>
      <p>A quick thank-you for being part of {{tenantName}} — this week only, take <strong>20% off</strong> any annual plan with code:</p>
      <div style="margin:24px 0;padding:18px;background:#fff7ed;border:2px dashed #f59e0b;border-radius:8px;text-align:center;">
        <p style="margin:0;color:#b45309;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;">SAVE20</p>
      </div>
      <p style="text-align:center;margin:32px 0 8px;">${BUTTON('Apply the code', '#', '#f59e0b')}</p>
      <p style="color:#6b7280;font-size:12px;margin-top:20px;text-align:center;">Offer ends Sunday 23:59. One per customer. No fine print games.</p>`,
    ),
  },
  {
    key: 'product_announcement',
    name: 'Product announcement',
    description: 'Introduce a new feature or release.',
    category: 'ANNOUNCEMENT',
    bodyHtml: PANEL(
      `<div style="background:#111827;padding:48px 32px 40px 32px;text-align:center;">
        <p style="margin:0;color:#a78bfa;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">New</p>
        <h1 style="margin:10px 0 0;color:#ffffff;font-size:30px;font-weight:800;letter-spacing:-0.02em;">Introducing something new</h1>
        <p style="margin:12px 0 0;color:#9ca3af;font-size:15px;">The thing we've been hinting at. It's here.</p>
      </div>`,
      `<p>Hi {{first_name}},</p>
      <p>We just shipped a feature a lot of you asked for — and honestly, we're a little proud of this one.</p>
      <div style="margin:24px 0;padding:24px;background:#faf5ff;border-radius:10px;">
        <p style="margin:0 0 8px;font-weight:700;color:#4c1d95;font-size:16px;">What's new</p>
        <p style="margin:0;color:#4c1d95;font-size:14px;line-height:1.6;">A short, specific description of what you built and why it matters to {{first_name}}'s day. Two sentences max.</p>
      </div>
      <p style="margin:24px 0 8px;font-weight:600;">Why it matters</p>
      <p>One concrete benefit with a number or outcome if you have one.</p>
      <p style="text-align:center;margin:32px 0 8px;">${BUTTON('See what\'s new', '#', '#7c3aed')}</p>`,
    ),
  },
  {
    key: 'event_invite',
    name: 'Event invite',
    description: 'Webinar / launch event RSVP request.',
    category: 'EVENT',
    bodyHtml: PANEL(
      `<div style="background:#fee2e2;padding:40px 32px;text-align:center;">
        <p style="margin:0;color:#b91c1c;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;">You're invited</p>
        <h1 style="margin:10px 0 0;color:#7f1d1d;font-size:28px;font-weight:800;letter-spacing:-0.02em;">A conversation on growth, live</h1>
      </div>`,
      `<p>Hi {{first_name}},</p>
      <p>We're hosting an intimate session with practitioners who've grown their lists past 100k. Live Q&amp;A, no slides.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#fff7ed;border-radius:10px;">
        <tr>
          <td style="padding:20px;">
            <p style="margin:0 0 4px;color:#9a3412;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">When</p>
            <p style="margin:0 0 12px;color:#7c2d12;font-size:15px;font-weight:600;">Thursday · 2:00 PM ET</p>
            <p style="margin:0 0 4px;color:#9a3412;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Where</p>
            <p style="margin:0;color:#7c2d12;font-size:15px;font-weight:600;">Online — link after RSVP</p>
          </td>
        </tr>
      </table>
      <p style="text-align:center;margin:28px 0 8px;">${BUTTON('RSVP — count me in', '#', '#dc2626')}</p>
      <p style="color:#6b7280;font-size:13px;text-align:center;margin-top:16px;">Can't make it? We'll send the recording.</p>`,
    ),
  },
  {
    key: 're_engagement',
    name: 'Re-engagement',
    description: 'Win back contacts who haven\'t engaged in a while.',
    category: 'OTHER',
    bodyHtml: PANEL(
      `<div style="padding:40px 32px 24px 32px;text-align:center;">
        <div style="display:inline-block;width:56px;height:56px;line-height:56px;background:#f1f5f9;border-radius:50%;font-size:28px;">👋</div>
        <h1 style="margin:16px 0 0;color:#0f172a;font-size:26px;font-weight:700;letter-spacing:-0.02em;">We've missed you, {{first_name}}</h1>
      </div>`,
      `<p>It's been a while. Here's a quick recap of what's new since we last talked — in case any of it is useful to you.</p>
      <ul style="margin:20px 0;padding:0;list-style:none;">
        <li style="padding:14px 16px;background:#f8fafc;border-radius:8px;margin-bottom:8px;">
          <strong style="color:#0f172a;">✨ Faster workflows.</strong>
          <span style="color:#475569;">Cut your campaign setup time in half.</span>
        </li>
        <li style="padding:14px 16px;background:#f8fafc;border-radius:8px;margin-bottom:8px;">
          <strong style="color:#0f172a;">📊 Richer analytics.</strong>
          <span style="color:#475569;">Understand what's working at a glance.</span>
        </li>
        <li style="padding:14px 16px;background:#f8fafc;border-radius:8px;">
          <strong style="color:#0f172a;">🤝 Still humans behind every reply.</strong>
          <span style="color:#475569;">Hit reply any time — we read it.</span>
        </li>
      </ul>
      <p style="text-align:center;margin:28px 0 8px;">${BUTTON('Take another look', '#', '#0f172a')}</p>
      <p style="color:#6b7280;font-size:12px;text-align:center;margin-top:20px;">Not interested anymore? <a href="{{unsubscribeUrl}}" style="color:#6b7280;">One click to unsubscribe</a> — we understand.</p>`,
    ),
  },
  {
    key: 'transactional_receipt',
    name: 'Transactional receipt',
    description: 'Order confirmation / receipt template.',
    category: 'TRANSACTIONAL',
    bodyHtml: PANEL(
      `<div style="padding:32px 32px 16px 32px;border-bottom:1px solid #e5e7eb;">
        <p style="margin:0;color:#16a34a;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Paid</p>
        <h1 style="margin:6px 0 0;color:#0f172a;font-size:22px;font-weight:700;letter-spacing:-0.01em;">Receipt for your order</h1>
        <p style="margin:6px 0 0;color:#6b7280;font-size:13px;">Order #{{orderId}} · {{orderDate}}</p>
      </div>`,
      `<p>Hi {{first_name}},</p>
      <p>Thanks for your purchase. Here's your receipt — keep it for your records.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:12px 0;color:#334155;font-size:14px;">Your item</td>
          <td style="padding:12px 0;color:#0f172a;font-size:14px;text-align:right;font-weight:600;">$—</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:12px 0;color:#334155;font-size:14px;">Tax</td>
          <td style="padding:12px 0;color:#0f172a;font-size:14px;text-align:right;">$—</td>
        </tr>
        <tr>
          <td style="padding:16px 0 0;color:#0f172a;font-size:15px;font-weight:700;">Total</td>
          <td style="padding:16px 0 0;color:#0f172a;font-size:15px;font-weight:700;text-align:right;">$—</td>
        </tr>
      </table>
      <p style="text-align:center;margin:28px 0 8px;">${BUTTON('View full invoice', '#', '#16a34a')}</p>
      <p style="color:#6b7280;font-size:12px;margin-top:20px;">Charged to the card ending in ••••. Need help? Reply to this email.</p>`,
    ),
  },
];
