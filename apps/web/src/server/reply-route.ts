/**
 * Phase 9 — short-token Reply-To routing.
 *
 * The Phase 8 M1 scheme HMAC-signed the routing payload straight into
 * the local-part (`reply+<kind><b64(payload)>.<b64(sig)>@…`). Real
 * payloads produced ~125-char local-parts, blowing past RFC 5321's
 * 64-char cap; Resend refused them and `buildReplyToAddress`
 * ultimately returned null, breaking inbound routing entirely.
 *
 * This module instead persists the routing target in the ReplyRoute
 * table and puts only an 8-char random token in the local-part.
 * Inbound lookup is a single indexed SELECT — cheaper than HMAC
 * verify — and revocable (just delete the row).
 *
 * Callers on the outbound path use `createReplyRoute()` and pass the
 * returned address as `Reply-To`. Callers on the inbound path use
 * `resolveReplyToken()` to fetch the target.
 */
import { randomBytes } from 'node:crypto';

import { prisma } from '@getyn/db';

const DEFAULT_TTL_DAYS = 90;

export type ReplyRouteKind = 'c' | 'a' | 'w';

export interface ReplyRouteTarget {
  kind: ReplyRouteKind;
  targetId: string;
  tenantId: string;
  nodeId?: string | null;
}

/**
 * Mint a new ReplyRoute row and return the full email address the
 * caller should stamp on the outbound message's Reply-To header.
 * Returns `null` when the routing domain isn't configured — callers
 * should fall back to omitting Reply-To rather than sending an
 * unroutable value.
 */
export async function createReplyRoute(
  target: ReplyRouteTarget,
  opts: { inboundDomain: string | null; ttlDays?: number },
): Promise<string | null> {
  if (!opts.inboundDomain) return null;

  // 6 raw bytes → 8 chars base64url. Retry once on the astronomically
  // unlikely uniqueness clash, then bubble the error (extremely rare).
  let token = mintToken();
  const ttlMs = (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
  try {
    await prisma.replyRoute.create({
      data: {
        token,
        kind: target.kind,
        targetId: target.targetId,
        tenantId: target.tenantId,
        nodeId: target.nodeId ?? null,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
  } catch {
    token = mintToken();
    await prisma.replyRoute.create({
      data: {
        token,
        kind: target.kind,
        targetId: target.targetId,
        tenantId: target.tenantId,
        nodeId: target.nodeId ?? null,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
  }
  return `reply+${token}@${opts.inboundDomain}`;
}

/** Look up a routing target by its short token. Returns null when
 *  the token doesn't exist or has expired. */
export async function resolveReplyToken(
  token: string,
): Promise<ReplyRouteTarget | null> {
  const row = await prisma.replyRoute.findUnique({ where: { token } });
  if (!row) return null;
  if (row.expiresAt < new Date()) return null;
  return {
    kind: row.kind as ReplyRouteKind,
    targetId: row.targetId,
    tenantId: row.tenantId,
    nodeId: row.nodeId,
  };
}

function mintToken(): string {
  // base64url = URL-safe (no `+` or `/`), no padding — safe inside an
  // email local-part.
  return randomBytes(6)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
