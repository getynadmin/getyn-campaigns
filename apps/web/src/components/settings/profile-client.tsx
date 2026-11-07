'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

/**
 * Settings → My profile. User-scoped, tenant-private: reads + writes
 * are always for the caller. Avatar upload POSTs to
 * /api/profile/avatar which handles Supabase storage; updated URL is
 * saved on User and reflected instantly in the topbar via query
 * invalidation (auth.session + profile.me).
 */
export function ProfileClient(): JSX.Element {
  const utils = api.useUtils();
  const me = api.profile.me.useQuery();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const update = api.profile.update.useMutation({
    onSuccess: async () => {
      toast.success('Profile updated.');
      await Promise.all([
        utils.profile.me.invalidate(),
        utils.auth.session.invalidate(),
      ]);
      setNameDirty(false);
    },
    onError: (err) => toast.error(err.message ?? 'Could not update profile.'),
  });

  const changePassword = api.profile.changePassword.useMutation({
    onSuccess: () => {
      toast.success('Password updated. Use it next time you sign in.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err) => toast.error(err.message ?? 'Could not update password.'),
  });

  if (me.isLoading || !me.data) {
    return <Skeleton className="h-64" />;
  }

  const user = me.data;
  const displayName = nameDirty ? name : (user.name ?? '');
  const initials = (user.name ?? user.email)
    .split(/\s+/)
    .map((s) => s.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Max 5MB.');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/profile/avatar', { method: 'POST', body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'upload failed' }));
        throw new Error(err.error ?? 'upload failed');
      }
      toast.success('Avatar updated.');
      await Promise.all([
        utils.profile.me.invalidate(),
        utils.auth.session.invalidate(),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onSaveName = () => {
    if (!displayName.trim()) return toast.error('Name is required.');
    update.mutate({ name: displayName.trim() });
  };

  const canChangePassword = !!user.supabaseUserId;

  const onSubmitPassword = () => {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    changePassword.mutate({ newPassword });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>My profile</CardTitle>
          <CardDescription>
            Your personal account. These settings follow you across every
            workspace you belong to.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              {user.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt={user.name ?? user.email} />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <Button
                variant="outline"
                size="sm"
                onClick={onPickFile}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : null}
                {user.avatarUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                JPG, PNG or GIF — up to 5MB.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Full name</Label>
              <Input
                value={displayName}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameDirty(true);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={user.email} disabled />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={onSaveName}
              disabled={!nameDirty || update.isPending}
            >
              {update.isPending ? (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              ) : null}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            {canChangePassword
              ? 'Set a new password for this account.'
              : 'This account signs in via SSO — change your password with your identity provider.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Current password</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={!canChangePassword}
                autoComplete="current-password"
              />
              <p className="text-[11px] text-muted-foreground">
                Needed by your browser; the new password itself is enough to update server-side.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">New password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={!canChangePassword}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Confirm new password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={!canChangePassword}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={onSubmitPassword}
              disabled={!canChangePassword || changePassword.isPending}
            >
              {changePassword.isPending ? (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              ) : null}
              Update password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
