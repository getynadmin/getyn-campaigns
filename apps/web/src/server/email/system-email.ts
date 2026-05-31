/**
 * Phase 5.6 M3 — system notification email pipeline.
 *
 * `sendSystemEmail({ to, templateSlug, variables, replyTo? })` is the
 * single entry point for transactional + notification emails (welcome,
 * password reset, plan upgrades, impersonation notices, ...).
 *
 * Renderer: simple `{{var}}` substitution with an HTML-escape pass on
 * each value. Unknown variables stay as-is so authors can see them
 * during template editing.
 *
 * Transport selection:
 *   1. SMTP integration when enabled (M3a)
 *   2. Resend transactional API when RESEND_API_KEY is set (Phase 1
 *      fallback — still works during migration)
 *   3. console.log in dev when neither is configured (won't break the
 *      app — useful for local development)
 */
import { Resend } from 'resend';

import { prisma } from '@getyn/db';

import { getSmtpCredentials, sendViaSmtp } from '@/server/integrations/smtp';

/** Result reported by every transport branch. */
export interface SendResult {
  ok: boolean;
  via: 'smtp' | 'resend' | 'console';
  messageId?: string;
  error?: string;
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

/**
 * Substitute `{{name}}` placeholders. HTML body values are escaped;
 * text body values are passed through (no HTML to escape against).
 * Subject is treated as plain text.
 */
function render(
  template: string,
  vars: Record<string, string>,
  htmlContext: boolean,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in vars)) return match;
    const v = String(vars[key]);
    return htmlContext ? escapeHtml(v) : v;
  });
}

export interface SendSystemEmailArgs {
  to: string;
  templateSlug: string;
  variables?: Record<string, string>;
  replyTo?: string;
}

export async function sendSystemEmail(
  args: SendSystemEmailArgs,
): Promise<SendResult> {
  const template = await prisma.systemEmailTemplate.findUnique({
    where: { slug: args.templateSlug },
  });
  if (!template || !template.enabled) {
    return {
      ok: false,
      via: 'console',
      error: `Template ${args.templateSlug} not found or disabled.`,
    };
  }
  const vars = args.variables ?? {};
  const subject = render(template.subject, vars, false);
  const html = render(template.bodyHtml, vars, true);
  const text = render(template.bodyText, vars, false);

  // 1) SMTP when configured.
  const smtp = await getSmtpCredentials();
  if (smtp.enabled) {
    const res = await sendViaSmtp({
      to: args.to,
      subject,
      html,
      text,
      replyTo: args.replyTo,
    });
    return { via: 'smtp', ...res };
  }

  // 2) Resend fallback (Phase 1 path). Uses env directly — the
  //    Resend integration UI lands in M4a.
  const resendKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM_EMAIL;
  if (resendKey && resendFrom) {
    try {
      const resend = new Resend(resendKey);
      const r = await resend.emails.send({
        from: resendFrom,
        to: args.to,
        subject,
        html,
        text,
        replyTo: args.replyTo,
      });
      if (r.error) {
        return { ok: false, via: 'resend', error: r.error.message };
      }
      return { ok: true, via: 'resend', messageId: r.data?.id };
    } catch (err) {
      return {
        ok: false,
        via: 'resend',
        error: err instanceof Error ? err.message : 'Resend send failed',
      };
    }
  }

  // 3) Dev fallback — log to console so the app never crashes when
  //    nothing is configured.
  console.info(
    `[system-email:console] (no transport configured) to=${args.to} subject=${subject}`,
  );
  return {
    ok: false,
    via: 'console',
    error: 'No email transport configured (SMTP disabled, Resend missing).',
  };
}
