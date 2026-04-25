'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/trpc';

/**
 * Client-side body for `/invite/[token]`. Rendered when the lookup says
 * the invite is valid AND the viewer is logged in as the invitee's email.
 * All other cases (expired / wrong email / not logged in) are handled by
 * the server page — this component is small on purpose.
 */
export function InviteAcceptCard({
  token,
  workspaceName,
  role,
}: {
  token: string;
  workspaceName: string;
  role: string;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();

  const accept = api.invitation.accept.useMutation({
    onSuccess: (res) => {
      toast.success('Joined workspace.');
      void utils.auth.session.invalidate();
      router.refresh();
      if (res.tenant) {
        router.push(`/t/${res.tenant.slug}/dashboard`);
      } else {
        router.push('/');
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        You&apos;ll join <span className="font-medium text-foreground">{workspaceName}</span>{' '}
        as a{' '}
        <span className="font-medium text-foreground capitalize">
          {role.toLowerCase()}
        </span>
        .
      </p>
      <Button
        className="w-full"
        onClick={() => accept.mutate({ token })}
        disabled={accept.isPending}
      >
        {accept.isPending ? 'Joining…' : 'Accept & continue'}
      </Button>
      <Button asChild variant="ghost">
        <Link href="/">Not now</Link>
      </Button>
    </div>
  );
}
