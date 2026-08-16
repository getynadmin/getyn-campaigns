/**
 * Phase 9 — short-token Reply-To routing (worker copy).
 *
 * Mirrors apps/web/src/server/reply-route.ts so outbound send paths in
 * the worker can mint routes without cross-app imports. Kept small
 * and dependency-free; the source of truth for the routing model is
 * the ReplyRoute Prisma model shared via @getyn/db.
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

export async function createReplyRoute(
  target: ReplyRouteTarget,
  opts: { inboundDomain: string | null; ttlDays?: number },
): Promise<string | null> {
  if (!opts.inboundDomain) return null;
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
  return randomBytes(6)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
