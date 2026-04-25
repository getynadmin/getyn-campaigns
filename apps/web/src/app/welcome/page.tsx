import { redirect } from 'next/navigation';

import { WelcomeForm } from '@/components/auth/welcome-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';
import { getCurrentUser } from '@/server/auth/session';
import { prisma } from '@getyn/db';

export const metadata = {
  title: 'Welcome',
};

/**
 * Provisioning landing page for OAuth users who don't have a DB row
 * yet. If we find a membership we just bounce them into their first
 * workspace; otherwise we render the name/workspace form.
 */
export default async function WelcomePage(): Promise<JSX.Element> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect('/login');
  }

  const user = await getCurrentUser();
  if (user) {
    const first = await prisma.membership.findFirst({
      where: { userId: user.id },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    if (first) {
      redirect(`/t/${first.tenant.slug}/dashboard`);
    }
    // User row exists but no memberships — treat as onboarding.
  }

  const defaultName =
    (data.user.user_metadata?.name as string | undefined) ?? '';

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Getyn</CardTitle>
          <CardDescription>
            Let&apos;s set up your workspace. You can rename it any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WelcomeForm defaultName={defaultName} />
        </CardContent>
      </Card>
    </main>
  );
}
