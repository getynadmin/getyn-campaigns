/* eslint-disable no-console */
import { Resend } from 'resend';

import { serverEnv } from '@/lib/env';

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
  const apiKey = serverEnv.resendApiKey();

  if (!apiKey) {
    console.info('[email:stub] no RESEND_API_KEY — logging instead of sending');
    console.info(`[email:stub] to:      ${to}`);
    console.info(`[email:stub] from:    ${serverEnv.resendFromEmail()}`);
    console.info(`[email:stub] subject: ${subject}`);
    console.info('[email:stub] ----- text -----');
    console.info(text);
    console.info('[email:stub] ----------------');
    return;
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: serverEnv.resendFromEmail(),
    to,
    subject,
    html,
    text,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
