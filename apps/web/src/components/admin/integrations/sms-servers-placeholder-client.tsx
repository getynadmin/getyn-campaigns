'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

/**
 * SMS engine admin. Twilio is the only live provider for now; the
 * MSG91 tab stays as a "Coming soon" placeholder behind the same
 * tabs so adding the next provider is additive rather than a rewrite.
 */
export function SmsServersPlaceholderClient(): JSX.Element {
  return (
    <Tabs defaultValue="twilio" className="space-y-4">
      <TabsList>
        <TabsTrigger value="twilio">Twilio</TabsTrigger>
        <TabsTrigger value="msg91">MSG91</TabsTrigger>
      </TabsList>
      <TabsContent value="twilio">
        <TwilioForm />
      </TabsContent>
      <TabsContent value="msg91">
        <ComingSoon />
      </TabsContent>
    </Tabs>
  );
}

function TwilioForm(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.integrations.twilio.get.useQuery();
  const [hydrated, setHydrated] = useState(false);
  const [accountSid, setAccountSid] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editToken, setEditToken] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    if (!data || hydrated) return;
    setAccountSid(data.config.accountSid);
    setFromNumber(data.config.fromNumber);
    setEnabled(data.enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.integrations.twilio.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      setEditToken(false);
      setAuthToken('');
      void utils.integrations.twilio.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const send = adminApi.integrations.twilio.sendTest.useMutation({
    onSuccess: () => {
      toast.success('Test SMS sent.');
      setTestOpen(false);
      setTestTo('');
      void utils.integrations.twilio.get.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void utils.integrations.twilio.get.invalidate();
    },
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <StatusCard
        status={data.lastTestStatus}
        lastTestedAt={data.lastTestedAt}
        error={data.lastTestError}
      />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Account SID</Label>
            <Input
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From Number or Messaging-Service SID</Label>
            <Input
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
              placeholder="+15551234567 or MGxxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Auth Token</Label>
            {editToken || !data.hasSecrets ? (
              <div className="flex gap-2">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={
                    data.hasSecrets ? 'Type new auth token' : 'Auth token'
                  }
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken((v) => !v)}
                >
                  {showToken ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </Button>
                {data.hasSecrets && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditToken(false)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value="••••••••••••"
                  readOnly
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditToken(true)}
                >
                  Replace
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-emerald-600"
            />
            Enable Twilio
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!data.enabled || send.isPending}
              onClick={() => setTestOpen(true)}
            >
              <Send className="mr-1 size-3.5" />
              Send test
            </Button>
            <Button
              size="sm"
              onClick={() =>
                save.mutate({
                  accountSid: accountSid.trim(),
                  fromNumber: fromNumber.trim(),
                  authToken,
                  enabled,
                })
              }
              disabled={save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 size-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send test SMS</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">To (E.164)</Label>
            <Input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="+15551234567"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!testTo.trim() || send.isPending}
              onClick={() => send.mutate({ to: testTo.trim() })}
            >
              {send.isPending ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : null}
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
  lastTestedAt: Date | string | null;
  error: string | null;
}): JSX.Element {
  const tone =
    status === 'OK'
      ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-900'
      : status === 'FAILED'
        ? 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-900'
        : 'bg-muted text-muted-foreground border-border';
  const Icon =
    status === 'OK' ? ShieldCheck : status === 'FAILED' ? ShieldAlert : Check;
  return (
    <div
      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-xs ${tone}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">
          {status === 'OK'
            ? 'Last test passed.'
            : status === 'FAILED'
              ? 'Last test failed.'
              : 'Not tested yet.'}
        </p>
        {lastTestedAt ? (
          <p className="opacity-80">
            Tested{' '}
            {new Date(lastTestedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 break-words font-mono text-[11px] opacity-80">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ComingSoon(): JSX.Element {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Coming soon
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          ['Auth Key', '••••••••'],
          ['Sender ID', 'GETYN'],
        ].map(([label, placeholder]) => (
          <div key={label} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input disabled placeholder={placeholder} />
          </div>
        ))}
      </div>
    </section>
  );
}
