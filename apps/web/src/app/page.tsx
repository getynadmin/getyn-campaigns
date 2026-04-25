import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@getyn/db';

/**
 * The root is a router, not a landing page:
 *
 *   - No Supabase session           → marketing / CTA (login + signup).
 *   - Supabase session, no DB User  → `/welcome` to provision their first
 *                                     workspace (OAuth path only).
 *   - Supabase session, DB User,
 *     no membership                 → `/welcome` (edge case, rare).
 *   - Supabase session + membership → first workspace dashboard.
 */
export default async function Home(): Promise<JSX.Element> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    const user = await getCurrentUser();
    if (!user) {
      redirect('/welcome');
    }
    const first = await prisma.membership.findFirst({
      where: { userId: user.id },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!first) {
      redirect('/welcome');
    }
    redirect(`/t/${first.tenant.slug}/dashboard`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground">
          <Sparkles className="size-3.5" />
          Phase 1 — Foundations
        </div>
        <h1 className="font-display text-5xl font-semibold tracking-tight sm:text-6xl">
          Getyn Campaigns
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Email, WhatsApp, and SMS marketing with an AI copilot and a
          drag-and-drop builder. Foundations going in now — auth, app shell,
          and team invites first.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">
              Create workspace <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
