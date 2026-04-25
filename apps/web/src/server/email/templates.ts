import { publicEnv } from '@/lib/env';

import type { SendEmailArgs } from './resend';

interface InviteEmailArgs {
  to: string;
  inviterName: string;
  workspaceName: string;
  token: string;
}

/**
 * Build a simple invitation email payload. Kept deliberately plain (no MJML,
 * no Unlayer yet) — rich template rendering is a later-phase concern. The
 * goal for Phase 1 is just "user receives a clickable link".
 */
export function buildInviteEmail({
  to,
  inviterName,
  workspaceName,
  token,
}: InviteEmailArgs): SendEmailArgs {
  const acceptUrl = `${publicEnv.appUrl()}/invite/${token}`;
  const subject = `${inviterName} invited you to ${workspaceName} on Getyn Campaigns`;

  const text = [
    `${inviterName} invited you to join ${workspaceName} on Getyn Campaigns.`,
    '',
    'Accept the invitation here:',
    acceptUrl,
    '',
    'If you weren’t expecting this, you can safely ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">You're invited to ${escapeHtml(workspaceName)}</h1>
      <p style="line-height: 1.55; margin: 0 0 20px;">
        ${escapeHtml(inviterName)} invited you to collaborate on
        <strong>${escapeHtml(workspaceName)}</strong> in Getyn Campaigns.
      </p>
      <p style="margin: 0 0 28px;">
        <a href="${acceptUrl}" style="display: inline-block; background: #FFE01B; color: #111; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 600;">
          Accept invitation
        </a>
      </p>
      <p style="color: #666; font-size: 13px; line-height: 1.55; margin: 0;">
        Or paste this link into your browser: <br/>
        <a href="${acceptUrl}" style="color: #666;">${acceptUrl}</a>
      </p>
    </div>
  `;

  return { to, subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
