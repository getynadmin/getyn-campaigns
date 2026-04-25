/* eslint-disable no-console */
import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { Role, prisma } from '@getyn/db';

import { publicEnv, serverEnv } from '@/lib/env';
import { getCurrentUser } from '@/server/auth/session';

/**
 * Custom image uploader for Unlayer's email editor.
 *
 * Wiring: in `EmailBuilder.onReady` we call
 *   `unlayer.registerCallback('image', (file, done) => { POST here ... })`
 * so every drag-drop or browse-and-pick lands here.
 *
 * Flow:
 *   1. Authenticate the caller's session (cookie).
 *   2. Validate the tenant slug query param + the caller's membership.
 *   3. Upload the file via Supabase service role to
 *      email-assets/{tenantId}/{uuid}.{ext}.
 *   4. Issue a 1-year signed URL (URL bypasses RLS, so anonymous email
 *      recipients can fetch the image; the bucket itself stays private).
 *   5. Return `{ url }` to the editor — Unlayer inserts an <img src=...>.
 *
 * Auth model:
 *   - Any tenant member (any role) can upload — designing campaigns is
 *     not gated to OWNER/ADMIN. Mutating campaigns IS gated, just not
 *     the asset upload step.
 *
 * Security caveat:
 *   - We trust the server-side MIME check on the bucket (configured in
 *     M0: `image/jpeg, image/png, image/gif, image/webp`). The Storage
 *     RLS policies for the bucket also gate writes to the caller's
 *     tenant prefix — but service-role uploads bypass that, so we
 *     enforce the prefix in code here.
 *   - 25MB max enforced via the bucket's `file_size_limit`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const tenantSlug = url.searchParams.get('tenant');
  if (!tenantSlug) {
    return NextResponse.json(
      { error: 'Missing tenant query param.' },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    return NextResponse.json({ error: 'Workspace not found.' }, { status: 404 });
  }
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    select: { role: true },
  });
  if (!membership) {
    return NextResponse.json(
      { error: 'No access to this workspace.' },
      { status: 403 },
    );
  }
  // Read-only roles can upload images while previewing — the gating on
  // mutating the template / campaign happens at the tRPC layer.
  if (membership.role === Role.VIEWER) {
    return NextResponse.json(
      { error: 'Viewers cannot upload assets.' },
      { status: 403 },
    );
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file.' }, { status: 400 });
  }

  // Defense in depth on top of the bucket's allowed_mime_types.
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 },
    );
  }

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const objectPath = `${tenant.id}/${randomUUID()}.${ext}`;

  const supabase = createClient(
    publicEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from('email-assets')
    .upload(objectPath, buf, {
      contentType: file.type,
      upsert: false,
    });
  if (upErr) {
    console.error('[upload] storage upload failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // 1-year signed URL — Unlayer embeds this directly into the design's
  // HTML, which we render at send time and persist as immutable. URLs
  // older than 1 year would 401 in the recipient's email client.
  const { data: signed, error: signErr } = await supabase.storage
    .from('email-assets')
    .createSignedUrl(objectPath, 60 * 60 * 24 * 365);
  if (signErr || !signed) {
    console.error('[upload] sign url failed:', signErr?.message);
    return NextResponse.json(
      { error: signErr?.message ?? 'Could not sign URL' },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signed.signedUrl, path: objectPath });
}
