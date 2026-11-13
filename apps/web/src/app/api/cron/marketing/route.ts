import { NextResponse, type NextRequest } from 'next/server';

import { runCartRecovery, runRetargeting } from '@/server/marketing';

/**
 * Phase 5.6 M8 — Marketing cron dispatcher.
 *
 * Runs both Retargeting and Cart Recovery on every tick. Vercel's
 * cron schedule in vercel.json fires `GET /api/cron/marketing`.
 *
 * Auth: Bearer CRON_SECRET header required (Vercel sends it on its
 * cron invocations when the env var is set). Returns 503 until the
 * secret is configured so first-boot can't leak the surface.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const [retarget, cart] = await Promise.all([runRetargeting(), runCartRecovery()]);
  return NextResponse.json({ retarget, cart, ranAt: new Date().toISOString() });
}
