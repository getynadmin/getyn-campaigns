/**
 * Phase 7.2 — finalize-time bucket copy.
 *
 * When the email agent finalizes a draft, any block image URLs that
 * point at the agent-attachments bucket are transient (24h signed)
 * and would 401 in a recipient's email client by the time the
 * campaign ships. Copy the Storage object to the email-assets bucket
 * (where the existing email-image uploader lives) and rewrite the
 * block URL to a 1-year signed URL — the same durability model email
 * blocks have used since Phase 3.
 *
 * Applies to BOTH uploaded images (via use_attachment_in_block) AND
 * AI-generated images (via generate_image_for_block) — the cleanup
 * cron on agent-attachments removes the originals after 30d, but the
 * finalized email keeps its own permanent copy in email-assets.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { publicEnv, serverEnv } from '@/lib/env';

import type { PlanBlockState } from './tools/email/state';

const SRC_BUCKET = 'agent-attachments';
const DST_BUCKET = 'email-assets';
/** Image placeholder keys the composer recognises. */
const IMAGE_PLACEHOLDER_KEYS = new Set([
  'image_url',
  'icon_1',
  'icon_2',
  'icon_3',
  'logo_url',
]);
/** Match Supabase signed-URL pattern for agent-attachments. */
const SIGNED_URL_PATTERN = /\/storage\/v1\/object\/sign\/agent-attachments\/([^?]+)/;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function getSupabase(): SupabaseClient {
  return createClient(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Extract `{tenantId}/{convId}/{file}` from an agent-attachments
 *  signed URL. Returns null if the URL doesn't match the pattern (so
 *  external URLs / brand defaults pass through untouched). */
function extractAgentAttachmentPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(SIGNED_URL_PATTERN);
  if (!match) return null;
  // Decode in case the path was URL-encoded by Supabase.
  return decodeURIComponent(match[1] ?? '');
}

/** Derive a stable email-assets path. We keep the original
 *  agent-attachments asset id in the destination filename so the
 *  copy is traceable back to the conversation if we ever audit. */
function destinationPath(srcPath: string, tenantId: string): string {
  const file = srcPath.split('/').pop() ?? srcPath;
  return `${tenantId}/from-agent/${file}`;
}

/**
 * Walk every block's placeholder values; for each that points at
 * agent-attachments, copy and rewrite. Mutates a fresh copy of the
 * plan — the input is untouched.
 *
 * Failure mode: per-URL try/catch — if one copy fails we leave the
 * 24h signed URL in place and surface a warning. Better to ship with
 * one short-lived URL than abort finalize.
 */
export async function copyAgentAttachmentsToEmailAssets(args: {
  plan: PlanBlockState[];
  tenantId: string;
}): Promise<{
  plan: PlanBlockState[];
  copiedCount: number;
  warnings: string[];
}> {
  const supabase = getSupabase();
  const warnings: string[] = [];
  let copiedCount = 0;
  // Memoise so a single attachment referenced from two blocks copies
  // once and yields the same destination URL.
  const cache = new Map<string, string>();

  const nextPlan: PlanBlockState[] = [];
  for (const block of args.plan) {
    const nextContent: Record<string, unknown> = { ...block.content };
    for (const [key, value] of Object.entries(block.content)) {
      if (!IMAGE_PLACEHOLDER_KEYS.has(key)) continue;
      const srcPath = extractAgentAttachmentPath(value);
      if (!srcPath) continue;

      if (cache.has(srcPath)) {
        nextContent[key] = cache.get(srcPath);
        continue;
      }

      try {
        const dstPath = destinationPath(srcPath, args.tenantId);
        // Download from agent-attachments…
        const dl = await supabase.storage.from(SRC_BUCKET).download(srcPath);
        if (dl.error || !dl.data) {
          warnings.push(
            `Could not fetch ${key} image from agent-attachments — keeping 24h URL.`,
          );
          continue;
        }
        const buf = Buffer.from(await dl.data.arrayBuffer());
        // …upload to email-assets. upsert: true so a re-finalize is
        // idempotent.
        const up = await supabase.storage.from(DST_BUCKET).upload(dstPath, buf, {
          contentType: dl.data.type || 'image/png',
          upsert: true,
        });
        if (up.error) {
          warnings.push(
            `Could not copy ${key} to email-assets: ${up.error.message}.`,
          );
          continue;
        }
        const signed = await supabase.storage
          .from(DST_BUCKET)
          .createSignedUrl(dstPath, ONE_YEAR_SECONDS);
        if (signed.error || !signed.data) {
          warnings.push(
            `Could not mint permanent URL for ${key}: ${signed.error?.message ?? 'unknown'}.`,
          );
          continue;
        }
        cache.set(srcPath, signed.data.signedUrl);
        nextContent[key] = signed.data.signedUrl;
        copiedCount += 1;
      } catch (err) {
        warnings.push(
          `Could not migrate ${key}: ${err instanceof Error ? err.message : 'unknown'}.`,
        );
      }
    }
    nextPlan.push({ ...block, content: nextContent });
  }

  return { plan: nextPlan, copiedCount, warnings };
}
