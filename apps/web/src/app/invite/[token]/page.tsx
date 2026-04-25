import Link from 'next/link';

import { InviteAcceptCard } from '@/components/auth/invite-accept-card';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createCaller } from '@/server/trpc/root';
import { createTRPCContext } from '@/server/trpc/context';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/server/auth/supabase-server';

export const metadata = { title: 'Accept invitation' };

/**
 * The invitee lands here. We:
 *   1. Look up the token (server-side, unauthenticated).
 *   2. If invalid/expired/accepted → show a terminal message.
 *   3. If they're not logged in → nudge them to sign up / log in
 *      using the invited email.
 *   4. If they're logged in as a different email → explain the mismatch.
 *   5. Otherwise render the "Accept & continue" button.
 */
export default async function InvitePage({
  params,
}: {
  params: { token: string };
}): Promise<JSX.Element> {
  const caller = createCaller(
    await createTRPCContext({ headers: headers() }),
  );
  const lookup = await caller.invitation.lookup({ token: params.token });

  if (lookup.status !== 'valid') {
    return (
      <Shell title="Invitation unavailable">
        <p className="text-sm text-muted-foreground">
          {lookup.status === 'expired'
            ? 'This invitation has expired. Ask the workspace owner to send a new one.'
            : lookup.status === 'already_accepted'
              ? 'This invitation has already been accepted.'
              : 'We couldn\u2019t find that invitation.'}
        </p>
        <CardFooter className="px-0 pt-4">
          <Button asChild variant="outline">
            <Link href="/login">Back to login</Link>
          </Button>
        </CardFooter>
      </Shell>
    );
  }

  const supabase = createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  // Logged out — send them through signup (prefilled) or login.
  if (!data.user) {
    const next = `/invite/${params.token}`;
    return (
      <Shell title="You\u2019re invited">
        <p className="text-sm text-muted-foreground">
          Sign in as{' '}
          <span className="font-medium text-foreground">{lookup.email}</span> to
          join <span className="font-medium text-foreground">{lookup.tenant.name}</span>.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button asChild>
            <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/login?next=${encodeURIComponent(next)}`}>I already have one</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  // Logged in but as a different email.
  if ((data.user.email ?? '').toLowerCase() !== lookup.email.toLowerCase()) {
    return (
      <Shell title="Different account">
        <p className="text-sm text-muted-foreground">
          This invitation was sent to{' '}
          <span className="font-medium text-foreground">{lookup.email}</span>,
          but you&apos;re signed in as{' '}
          <span className="font-medium text-foreground">{data.user.email}</span>.
          Sign out and log in with the invited email to accept.
        </p>
        <CardFooter className="flex gap-2 px-0 pt-4">
          <Button asChild variant="outline">
            <Link href="/login">Back to login</Link>
          </Button>
        </CardFooter>
      </Shell>
    );
  }

  return (
    <Shell title={`Join ${lookup.tenant.name}`}>
      <InviteAcceptCard
        token={params.token}
        workspaceName={lookup.tenant.name}
        role={lookup.role}
      />
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>Getyn Campaigns</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </main>
  );
}
