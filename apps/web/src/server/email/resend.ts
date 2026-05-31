/* eslint-disable no-console */
import { Resend } from 'resend';

import { getResendCredentials } from '@/server/integrations/resend';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send a transactional email via Resend.
 *
 * Dev fallback: when `RESEND_API_KEY` is unset, the email is logged to the
 * server console (including the full body) instead of going out over the
 * wire. This keeps the invite + password-reset flows usable locally without
 * needing a Resend account.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<void> {
  // Phase 5.6 M4a: prefer DB-stored Resend credentials, env fallback
  // preserved (RESEND_API_KEY + RESEND_FROM_EMAIL).
  const creds = await getResendCredentials();
  const apiKey = creds.apiKey;
  const from = creds.defaultFromEmail ?? '';

  if (!apiKey) {
    console.info('[email:stub] no Resend API key — logging instead of sending');
    console.info(`[email:stub] to:      ${to}`);
    console.info(`[email:stub] from:    ${from}`);
    console.info(`[email:stub] subject: ${subject}`);
    console.info('[email:stub] ----- text -----');
    console.info(text);
    console.info('[email:stub] ----------------');
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
