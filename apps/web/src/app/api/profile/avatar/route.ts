import { NextResponse } from 'next/server';

import { prisma } from '@getyn/db';

import { getCurrentUser } from '@/server/auth/session';
import { getSupabaseAdmin } from '@/server/auth/supabase-admin';

export const runtime = 'nodejs';

/**
 * POST /api/profile/avatar — multipart file upload of the caller's
 * avatar. Stored in a public `avatars` bucket at `avatars/<userId>/<ts>.<ext>`,
 * User.avatarUrl is updated, and the public URL is returned so the
 * client can invalidate caches + show the new image immediately.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'max 5MB' }, { status: 413 });
  }

  const admin = getSupabaseAdmin();
  const bucket = 'avatars';
  // Idempotent — ignore error if bucket already exists.
  try {
    await admin.storage.createBucket(bucket, { public: true });
  } catch {
    /* bucket likely exists */
  }

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5);
  const path = `${user.id}/${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from(bucket)
    .upload(path, bytes, {
      contentType: file.type || 'image/png',
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);
  const avatarUrl = pub.publicUrl;

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl },
  });

  return NextResponse.json({ avatarUrl });
}
