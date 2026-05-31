'use client';

import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Save, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

type Encryption = 'NONE' | 'STARTTLS' | 'TLS';

export function SmtpIntegrationClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.smtp.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [encryption, setEncryption] = useState<Encryption>('STARTTLS');
  const [username, setUsername] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyToEmail, setReplyToEmail] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editPassword, setEditPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    if (!data || hydrated) return;
    setHost(data.config.host);
    setPort(String(data.config.port));
    setEncryption(data.config.encryption as Encryption);
    setUsername(data.config.username);
    setFromEmail(data.config.fromEmail);
    setFromName(data.config.fromName);
    setReplyToEmail(data.config.replyToEmail);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.smtp.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditPassword(false);
      setPassword('');
      void utils.integrations.smtp.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const send = adminApi.integrations.smtp.sendTest.useMutation({
    onSuccess: () => {
      toast.success('Test email sent.');
      setTestOpen(false);
      setTestTo('');
      void utils.integrations.smtp.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.smtp.get.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <StatusCard status={data.lastTestStatus} lastTestedAt={data.lastTestedAt} error={data.lastTestError} />

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Host</Label>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.resend.com"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Port</Label>
            <Input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="587"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Encryption</Label>
            <div className="flex gap-1 rounded-md border p-1">
              {(['NONE', 'STARTTLS', 'TLS'] as Encryption[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setEncryption(opt)}
                  className={
                    'flex-1 rounded px-2 py-1 text-xs ' +
                    (encryption === opt
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="apikey or login"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Password</Label>
            {editPassword || !data.hasSecrets ? (
              <div className="flex gap-2">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={data.hasSecrets ? 'Type new password' : 'Password'}
                />
                <Button variant="outline" size="icon" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
                {data.hasSecrets && (
                  <Button variant="ghost" size="sm" onClick={() => setEditPassword(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input value="••••••••••••" readOnly className="font-mono" />
                <Button variant="outline" size="sm" onClick={() => setEditPassword(true)}>
                  Replace
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From email</Label>
            <Input
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="notifications@yourdomain.com"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From name</Label>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Getyn Campaigns"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Reply-to (optional)</Label>
            <Input
              type="email"
              value={replyToEmail}
              onChange={(e) => setReplyToEmail(e.target.value)}
              placeholder="support@yourdomain.com"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Enable SMTP</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              When enabled, system emails route through this server. Off = falls back to Resend transactional or console log.
            </span>
          </span>
        </label>

        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => setTestOpen(true)}>
            <Send className="mr-2 size-4" />
            Send test email
          </Button>
          <Button
            onClick={() =>
              save.mutate({
                host,
                port: Number(port) || 587,
                encryption,
                username,
                password: editPassword ? password : '',
                fromEmail,
                fromName,
                replyToEmail,
                enabled,
              })
            }
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Save
          </Button>
        </div>
      </section>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send test email</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Recipient</Label>
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={send.isPending || !testTo.trim()}
              onClick={() => send.mutate({ to: testTo.trim() })}
            >
              {send.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusCard({
  status,
  lastTestedAt,
  error,
}: {
  status: 'UNTESTED' | 'OK' | 'FAILED';
  lastTestedAt: Date | null;
  error: string | null;
}): JSX.Element {
  const cls =
    status === 'OK'
      ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
      : status === 'FAILED'
        ? 'border-rose-300 bg-rose-50/60 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
        : 'border-amber-300 bg-amber-50/60 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200';
  const Icon = status === 'OK' ? Check : status === 'FAILED' ? ShieldAlert : ShieldCheck;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        {status === 'OK' ? 'OK' : status === 'FAILED' ? 'Failed' : 'Untested'}
      </div>
      {lastTestedAt && (
        <p className="mt-1 text-xs opacity-80">
          Last tested {new Date(lastTestedAt).toLocaleString()}
        </p>
      )}
      {error && <p className="mt-1 text-xs opacity-80">Last error: {error}</p>}
    </div>
  );
}
