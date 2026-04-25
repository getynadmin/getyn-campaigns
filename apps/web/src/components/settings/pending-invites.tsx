'use client';

import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/trpc';

/**
 * Pending invites list. Shows email, role, who invited them, and the
 * expiry date. OWNER/ADMIN can revoke — the server enforces the role.
 */
export function PendingInvites({ canManage }: { canManage: boolean }): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.invitation.listPending.useQuery();

  const revoke = api.invitation.revoke.useMutation({
    onSuccess: () => {
      toast.success('Invite revoked.');
      void utils.invitation.listPending.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (!data || data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No pending invites.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">{inv.email}</TableCell>
              <TableCell>
                {inv.role.charAt(0) + inv.role.slice(1).toLowerCase()}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {inv.invitedBy?.name ?? inv.invitedBy?.email ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(inv.expiresAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => revoke.mutate({ invitationId: inv.id })}
                    disabled={revoke.isPending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
