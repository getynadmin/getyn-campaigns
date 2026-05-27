'use client';

import { LogOut, User as UserIcon } from 'lucide-react';

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
 * Avatar + dropdown in the topbar. Shows the current user's name and
 * email, and offers a sign-out action.
 *
 * Sign-out routes through the server-side /api/auth/logout endpoint
 * (Phase 5 M1) so both Supabase + Auth0 cookies clear in one round
 * trip, then federates to the IdP logout when SSO is configured.
 */
export function UserMenu({
  name,
  email,
  avatarUrl,
}: {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}): JSX.Element {
  const utils = api.useUtils();

  const initials = (name ?? email)
    .split(/\s+/)
    .map((s) => s.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  /**
   * Sign-out via the server-side /api/auth/logout endpoint.
   *
   * Phase 5 M1 unified the logout path so it clears BOTH the
   * Supabase HTTP-only cookie AND the new Auth0 session cookie,
   * then federates upstream when SSO is configured.
   *
   * Previously this called supabase.auth.signOut() client-side
   * which didn't reliably clear the HTTP-only cookie via the
   * browser SDK — the server-side flow does.
   *
   * We use a real navigation (window.location) rather than
   * router.push so the response's Set-Cookie headers actually
   * apply to subsequent requests; a client-side router transition
   * doesn't re-read cookies.
   */
  const signOut = (): void => {
    // Invalidate React-Query caches before the navigation lands so
    // the post-redirect state doesn't briefly flash stale data.
    utils.invalidate();
    window.location.href = '/api/auth/logout';
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full">
          <Avatar className="size-8">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={name ?? email} /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{name ?? 'Account'}</span>
          <span className="text-xs font-normal text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserIcon className="mr-2 size-4" />
          Profile (soon)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
