'use client';

import Link from 'next/link';
import { CreditCard, LogOut, User as UserIcon } from 'lucide-react';

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
import { api } from '@/lib/trpc';

/**
 * Avatar + dropdown in the topbar. Server props seed the initial
 * render; profile.me (live) overrides them so avatar/name updates
 * from the Profile tab appear here without a reload.
 */
export function UserMenu({
  name,
  email,
  avatarUrl,
  tenantSlug,
}: {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  tenantSlug?: string;
}): JSX.Element {
  const utils = api.useUtils();
  const live = api.profile.me.useQuery(undefined, {
    staleTime: 60_000,
  });

  const effName = live.data?.name ?? name;
  const effEmail = live.data?.email ?? email;
  const effAvatarUrl = live.data?.avatarUrl ?? avatarUrl;

  const initials = (effName ?? effEmail)
    .split(/\s+/)
    .map((s) => s.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const signOut = (): void => {
    utils.invalidate();
    window.location.href = '/api/auth/logout';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full">
          <Avatar className="size-8">
            {effAvatarUrl ? (
              <AvatarImage src={effAvatarUrl} alt={effName ?? effEmail} />
            ) : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{effName ?? 'Account'}</span>
          <span className="text-xs font-normal text-muted-foreground">{effEmail}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenantSlug ? (
          <DropdownMenuItem asChild>
            <Link href={`/t/${tenantSlug}/settings/profile`}>
              <UserIcon className="mr-2 size-4" />
              My profile
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <UserIcon className="mr-2 size-4" />
            Profile (soon)
          </DropdownMenuItem>
        )}
        {tenantSlug ? (
          <DropdownMenuItem asChild>
            <Link href={`/t/${tenantSlug}/settings/subscription`}>
              <CreditCard className="mr-2 size-4" />
              Manage plan
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
