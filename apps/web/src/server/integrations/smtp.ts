/**
 * Phase 5.6 M3a — SMTP credential resolver + nodemailer transport.
 *
 * Drives system-notification emails (welcome, password reset, plan
 * upgrades, impersonation notices, ...). Tenant marketing campaigns
 * still flow through Resend — that's a separate integration covered
 * by M4a.
 *
 * Fallback: when no DB row is enabled, defer to the existing Resend
 * transactional pipeline upstream (see system-email.ts). M3 prefers
 * SMTP-when-configured to give admins direct provider control.
 */
import { cache } from 'react';

import { loadIntegration } from './credential-store';

const PROVIDER = 'smtp_default';

export type SmtpEncryption = 'NONE' | 'STARTTLS' | 'TLS';

export interface SmtpConfig {
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  fromEmail: string;
  fromName: string;
  replyToEmail?: string | null;
}

export interface SmtpSecrets {
  password: string;
}

export interface ResolvedSmtp {
  enabled: boolean;
  config: SmtpConfig | null;
  password: string | null;
}

async function load(): Promise<ResolvedSmtp> {
  const row = await loadIntegration<SmtpConfig, SmtpSecrets>(PROVIDER);
  if (!row || !row.secrets) {
    return { enabled: false, config: null, password: null };
  }
  // Defensive defaults for half-filled rows.
  const config: SmtpConfig = {
    host: row.config.host ?? '',
    port: Number(row.config.port ?? 587),
    encryption: (row.config.encryption as SmtpEncryption) ?? 'STARTTLS',
    username: row.config.username ?? '',
    fromEmail: row.config.fromEmail ?? '',
    fromName: row.config.fromName ?? '',
    replyToEmail: row.config.replyToEmail ?? null,
  };
  return {
    enabled: true,
    config,
    password: row.secrets.password ?? null,
  };
}

export const getSmtpCredentials = cache(load);

/**
 * Send an arbitrary email via the configured SMTP server. Used by
 * both the system-email pipeline and the .sendTest admin mutation.
 */
export async function sendViaSmtp(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const smtp = await getSmtpCredentials();
  if (!smtp.enabled || !smtp.config || !smtp.password) {
    return { ok: false, error: 'SMTP integration is not configured.' };
  }
  // Dynamic import keeps nodemailer out of the edge bundle.
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: smtp.config.host,
    port: smtp.config.port,
    secure: smtp.config.encryption === 'TLS', // implicit TLS on port 465
    requireTLS: smtp.config.encryption === 'STARTTLS',
    auth: {
      user: smtp.config.username,
      pass: smtp.password,
    },
  });
  try {
    const info = await transport.sendMail({
      from: `${smtp.config.fromName} <${smtp.config.fromEmail}>`,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo:
        args.replyTo ?? smtp.config.replyToEmail ?? undefined,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'SMTP send failed',
    };
  }
}
