/**
 * Welcome email sent when staff manually creates a tenant from
 * /admin/tenants. Composed inline (no SystemEmailTemplate row) because
 * this is an admin-controlled, low-traffic path — the customization
 * surface a template adds doesn't pay for itself here.
 *
 * Delivery goes through sendViaSmtp so the message uses the workspace's
 * configured SMTP integration. Return value is the SMTP result.
 */
import { sendViaSmtp } from '@/server/integrations/smtp';

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

export interface WelcomeEmailArgs {
  to: string;
  ownerName: string | null;
  tenantName: string;
  loginUrl: string;
  email: string;
  /** Plaintext password — only present if staff opted to generate one. */
  password: string | null;
}

export async function sendTenantWelcomeEmail(
  args: WelcomeEmailArgs,
): Promise<{ ok: boolean; error?: string }> {
  const greeting = args.ownerName ? `Hi ${args.ownerName},` : 'Hi,';
  const passwordBlock = args.password
    ? `
      <p style="margin:0 0 8px 0;">Your sign-in details:</p>
      <table style="margin:0 0 16px 0;border-collapse:collapse;">
        <tr>
          <td style="padding:4px 12px 4px 0;color:#6b7280;">Email</td>
          <td style="padding:4px 0;font-family:ui-monospace,monospace;">${esc(args.email)}</td>
        </tr>
        <tr>
          <td style="padding:4px 12px 4px 0;color:#6b7280;">Temporary password</td>
          <td style="padding:4px 0;font-family:ui-monospace,monospace;">${esc(args.password)}</td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;color:#6b7280;font-size:13px;">
        Please change this password after your first sign-in from Settings → Account.
      </p>`
    : `
      <p style="margin:0 0 16px 0;">
        Use your email <strong>${esc(args.email)}</strong> to sign in.
      </p>`;

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;line-height:1.5;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;">Welcome to Getyn Campaigns</h1>
      <p style="margin:0 0 16px 0;">${esc(greeting)}</p>
      <p style="margin:0 0 16px 0;">
        Your workspace <strong>${esc(args.tenantName)}</strong> is ready.
      </p>
      ${passwordBlock}
      <p style="margin:24px 0 0 0;">
        <a href="${esc(args.loginUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500;">
          Sign in to ${esc(args.tenantName)}
        </a>
      </p>
      <p style="margin:24px 0 0 0;color:#6b7280;font-size:12px;">
        If the button doesn't work, paste this link into your browser:<br>
        <span style="word-break:break-all;">${esc(args.loginUrl)}</span>
      </p>
    </div>
  </body></html>`;

  const passwordLine = args.password ? `Temporary password: ${args.password}\n` : '';
  const text = `${greeting}

Your Getyn Campaigns workspace "${args.tenantName}" is ready.

Email: ${args.email}
${passwordLine}Sign in: ${args.loginUrl}

${args.password ? 'Please change your password after your first sign-in.\n' : ''}`;

  const result = await sendViaSmtp({
    to: args.to,
    subject: `Your Getyn Campaigns workspace "${args.tenantName}" is ready`,
    html,
    text,
  });
  return { ok: result.ok, error: result.error };
}

/**
 * Generate a strong, human-typeable password. 16 chars: lowercase,
 * uppercase, digits — no ambiguous lookalikes (0/O, 1/l/I).
 */
export function generateTenantPassword(): string {
  const alphabet =
    'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:crypto').randomFillSync(bytes);
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    const byte = bytes[i] ?? 0;
    out += alphabet[byte % alphabet.length];
  }
  return out;
}
