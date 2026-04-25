/* eslint-disable no-console */
import { Resend } from 'resend';

import type {
  SendingDomainDnsRecord,
  SendingDomainStatusValue,
} from '@getyn/types';

import { serverEnv } from '@/lib/env';

/**
 * Resend domain operations wrapper. The send-email path lives in `./resend.ts`;
 * domain CRUD lives here so the two stay independently testable and the
 * imports are obvious from the call sites.
 *
 * Dev fallback: when `RESEND_API_KEY` is unset, every operation returns a
 * deterministic stub. The UI can then exercise the full flow locally without
 * actually creating Resend domains. Production always hits the real API.
 *
 * Errors from the SDK come back as `{ error }` not as exceptions — we
 * normalize to thrown errors so the tRPC router can map them to TRPCError.
 */

export interface CreateDomainResult {
  resendDomainId: string;
  status: SendingDomainStatusValue;
  dnsRecords: SendingDomainDnsRecord[];
}

export interface DomainStatusResult {
  status: SendingDomainStatusValue;
  dnsRecords: SendingDomainDnsRecord[];
  verifiedAt: Date | null;
}

/**
 * Map Resend's raw `DomainStatus` string to our Prisma `SendingDomainStatus`
 * enum value. Resend's `temporary_failure` and `not_started` collapse to
 * PENDING because they're transient — the user shouldn't see them as a
 * separate state.
 */
function mapStatus(resend: string): SendingDomainStatusValue {
  switch (resend) {
    case 'verified':
      return 'VERIFIED';
    case 'failed':
      return 'FAILED';
    case 'pending':
    case 'temporary_failure':
    case 'not_started':
    default:
      return 'PENDING';
  }
}

/**
 * Convert Resend's mixed `DomainSpfRecord | DomainDkimRecord` shape into our
 * UI-friendly `SendingDomainDnsRecord`. We keep `record`, `priority`, `ttl`
 * for transparency in the UI; Resend's `proxy_status` and `routing_policy`
 * are uninteresting to end users.
 */
function mapRecord(r: unknown): SendingDomainDnsRecord {
  const x = r as Record<string, unknown>;
  return {
    type: (x.type as 'MX' | 'TXT' | 'CNAME') ?? 'TXT',
    name: String(x.name ?? ''),
    value: String(x.value ?? ''),
    status: (x.status as SendingDomainDnsRecord['status']) ?? 'pending',
    priority: typeof x.priority === 'number' ? x.priority : undefined,
    ttl: typeof x.ttl === 'string' ? x.ttl : undefined,
    record: typeof x.record === 'string' ? x.record : undefined,
  };
}

function client(): Resend | null {
  const key = serverEnv.resendApiKey();
  return key ? new Resend(key) : null;
}

function stubRecords(domain: string): SendingDomainDnsRecord[] {
  return [
    {
      record: 'SPF',
      type: 'TXT',
      name: domain,
      value: 'v=spf1 include:resend.dev ~all',
      ttl: '300',
      status: 'pending',
    },
    {
      record: 'DKIM',
      type: 'TXT',
      name: `resend._domainkey.${domain}`,
      value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN... (stub)',
      ttl: '300',
      status: 'pending',
    },
  ];
}

export async function createResendDomain(
  domain: string,
): Promise<CreateDomainResult> {
  const c = client();
  if (!c) {
    console.info(`[resend:stub] createDomain(${domain}) — no API key, stubbing`);
    return {
      resendDomainId: `stub-${domain}-${Date.now()}`,
      status: 'PENDING',
      dnsRecords: stubRecords(domain),
    };
  }
  const { data, error } = await c.domains.create({ name: domain });
  if (error) {
    throw new Error(`Resend.domains.create failed: ${error.message}`);
  }
  if (!data) {
    throw new Error('Resend.domains.create returned no data');
  }
  return {
    resendDomainId: data.id,
    status: mapStatus(data.status),
    dnsRecords: (data.records ?? []).map(mapRecord),
  };
}

export async function getResendDomain(
  resendDomainId: string,
): Promise<DomainStatusResult> {
  const c = client();
  if (!c) {
    console.info(
      `[resend:stub] getDomain(${resendDomainId}) — no API key, stubbing as PENDING`,
    );
    return {
      status: 'PENDING',
      dnsRecords: [],
      verifiedAt: null,
    };
  }
  const { data, error } = await c.domains.get(resendDomainId);
  if (error) {
    throw new Error(`Resend.domains.get failed: ${error.message}`);
  }
  if (!data) {
    throw new Error('Resend.domains.get returned no data');
  }
  const status = mapStatus(data.status);
  return {
    status,
    dnsRecords: (data.records ?? []).map(mapRecord),
    // Resend doesn't expose a verifiedAt timestamp directly; we set it to
    // "now" when the status flips to VERIFIED.
    verifiedAt: status === 'VERIFIED' ? new Date() : null,
  };
}

export async function verifyResendDomain(
  resendDomainId: string,
): Promise<DomainStatusResult> {
  const c = client();
  if (!c) {
    console.info(
      `[resend:stub] verifyDomain(${resendDomainId}) — flipping to VERIFIED in dev`,
    );
    return {
      status: 'VERIFIED',
      dnsRecords: [],
      verifiedAt: new Date(),
    };
  }
  const { error } = await c.domains.verify(resendDomainId);
  if (error) {
    throw new Error(`Resend.domains.verify failed: ${error.message}`);
  }
  // Verify is async on Resend's side — we re-fetch to read the updated state.
  return getResendDomain(resendDomainId);
}

export async function deleteResendDomain(
  resendDomainId: string,
): Promise<void> {
  const c = client();
  if (!c) {
    console.info(
      `[resend:stub] deleteDomain(${resendDomainId}) — no-op in dev`,
    );
    return;
  }
  const { error } = await c.domains.remove(resendDomainId);
  // 404 is fine — domain is already gone on Resend's side.
  if (error && !/not.?found/i.test(error.message)) {
    throw new Error(`Resend.domains.remove failed: ${error.message}`);
  }
}
