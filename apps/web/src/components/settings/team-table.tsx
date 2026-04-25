'use client';

import { MoreHorizontal } from 'lucide-react';
import { Role } from '@getyn/db';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

function roleLabel(role: Role): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Current members + per-row role menu. OWNER/ADMIN see the actions
 * dropdown; others see read-only rows.
 */
export function TeamTable({
  currentUserId,
  currentRole,
}: {
  currentUserId: string;
  currentRole: Role;
}): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.membership.list.useQuery();

  const updateRole = api.membership.updateRole.useMutation({
    onSuccess: () => {
      toast.success('Role updated.');
      void utils.membership.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = api.membership.remove.useMutation({
    onSuccess: () => {
      toast.success('Member removed.');
      void utils.membership.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const canManage = currentRole === Role.OWNER || currentRole === Role.ADMIN;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map((m) => {
            const isSelf = m.userId === currentUserId;
            const initials = (m.user.name ?? m.user.email)
              .split(/\s+/)
              .map((s) => s.charAt(0))
              .join('')
              .slice(0, 2)
              .toUpperCase();
            return (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      {m.user.avatarUrl ? (
                        <AvatarImage
                          src={m.user.avatarUrl}
                          alt={m.user.name ?? m.user.email}
                        />
                      ) : null}
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.user.name ?? m.user.email}
                        {isSelf ? (
                          <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.user.email}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{roleLabel(m.role)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(m.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {canManage && !isSelf ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Change role</DropdownMenuLabel>
                        {(
                          currentRole === Role.OWNER
                            ? [Role.OWNER, Role.ADMIN, Role.EDITOR, Role.VIEWER]
                            : [Role.ADMIN, Role.EDITOR, Role.VIEWER]
                        ).map((r) => (
                          <DropdownMenuItem
                            key={r}
                            disabled={r === m.role}
                            onSelect={() =>
                              updateRole.mutate({
                                membershipId: m.id,
                                role: r,
                              })
                            }
                          >
                            {roleLabel(r)}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => remove.mutate({ membershipId: m.id })}
                        >
                          Remove from workspace
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
