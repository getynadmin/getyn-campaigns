'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Phone,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { api, type RouterOutputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';

function formatPriceCents(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)} / mo`;
}

/**
 * Tenant-side SMS channel: pick your sender (phone number or alpha
 * sender ID). Powers SmsCampaign.fromNumber at send time.
 */
export function SmsChannelClient({
  tenantSlug: _tenantSlug,
  canManage,
}: {
  tenantSlug: string;
  canManage: boolean;
}): JSX.Element {
  const list = api.smsChannel.list.useQuery();
  const utils = api.useUtils();

  // Refresh when the window regains focus — a buy-flow open in a new
  // tab lands PAID in the background; this keeps the table current.
  useEffect(() => {
    const onFocus = (): void => {
      void utils.smsChannel.list.invalidate();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [utils]);

  if (list.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!list.data) return <p className="text-sm text-muted-foreground">Could not load.</p>;

  if (!list.data.twilioReady) {
    return (
      <Alert>
        <AlertTitle>SMS engine is not configured yet</AlertTitle>
        <AlertDescription>
          An administrator needs to set up the Twilio integration (Account
          SID + Auth Token) in the global admin area before tenants can
          buy numbers or register sender IDs.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Tabs defaultValue="numbers" className="w-full">
      <TabsList>
        <TabsTrigger value="numbers">Phone numbers</TabsTrigger>
        <TabsTrigger value="senders">Sender IDs</TabsTrigger>
      </TabsList>

      <TabsContent value="numbers" className="mt-4">
        <NumbersTab
          canManage={canManage}
          data={list.data}
          onChanged={() => void utils.smsChannel.list.invalidate()}
        />
      </TabsContent>
      <TabsContent value="senders" className="mt-4">
        <AlphaSendersTab
          canManage={canManage}
          data={list.data}
          onChanged={() => void utils.smsChannel.list.invalidate()}
        />
      </TabsContent>
    </Tabs>
  );
}

type ListData = RouterOutputs['smsChannel']['list'];

function NumbersTab({
  canManage,
  data,
  onChanged,
}: {
  canManage: boolean;
  data: ListData;
  onChanged: () => void;
}): JSX.Element {
  const [country, setCountry] = useState('US');
  const [areaCode, setAreaCode] = useState('');
  const [contains, setContains] = useState('');
  const [page, setPage] = useState(0);
  const [committed, setCommitted] = useState<{
    country: string;
    areaCode?: string;
    contains?: string;
  } | null>(null);

  const search = api.smsChannel.searchAvailableNumbers.useQuery(
    committed
      ? { country: committed.country, areaCode: committed.areaCode, contains: committed.contains, page }
      : { country: 'US', page: 0 },
    { enabled: Boolean(committed) },
  );

  const startPurchase = api.smsChannel.startPurchaseCheckout.useMutation({
    onSuccess: (res) => {
      if (res.previewMode) {
        toast.success(res.message ?? 'Number purchased (preview mode).');
        onChanged();
        return;
      }
      if (res.fwdUrl) {
        window.open(res.fwdUrl, '_blank', 'noopener,noreferrer');
        toast.info('Checkout opened in a new tab. The number appears here once payment clears.');
      }
    },
    onError: (err) => toast.error(err.message ?? 'Could not start checkout.'),
  });

  const release = api.smsChannel.releaseNumber.useMutation({
    onSuccess: () => {
      toast.success('Number released.');
      onChanged();
    },
    onError: (err) => toast.error(err.message ?? 'Could not release.'),
  });

  const runSearch = (): void => {
    setPage(0);
    setCommitted({ country, areaCode: areaCode.trim() || undefined, contains: contains.trim() || undefined });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your numbers</CardTitle>
          <CardDescription>
            Active Twilio numbers available as the SMS from-number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.phoneNumbers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No numbers yet — pick a country below and search to buy one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2 pr-3">Number</th>
                    <th className="pb-2 pr-3">Country</th>
                    <th className="pb-2 pr-3">Capabilities</th>
                    <th className="pb-2 pr-3">Monthly</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.phoneNumbers.map((n) => {
                    const caps = n.capabilities as {
                      sms?: boolean;
                      voice?: boolean;
                      mms?: boolean;
                    } | null;
                    return (
                      <tr key={n.id}>
                        <td className="py-2 pr-3">
                          <div className="font-mono text-foreground">{n.phoneNumber}</div>
                          {n.friendlyName ? (
                            <div className="text-xs text-muted-foreground">{n.friendlyName}</div>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">{n.country}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {caps?.sms ? <Cap tone="emerald">SMS</Cap> : null}
                            {caps?.mms ? <Cap tone="sky">MMS</Cap> : null}
                            {caps?.voice ? <Cap tone="violet">Voice</Cap> : null}
                          </div>
                        </td>
                        <td className="py-2 pr-3">{formatPriceCents(n.monthlyPriceCents)}</td>
                        <td className="py-2 text-right">
                          {canManage ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (!confirm(`Release ${n.phoneNumber}? This cannot be undone.`)) return;
                                release.mutate({ id: n.id });
                              }}
                              disabled={release.isPending}
                            >
                              <Trash2 className="mr-1 size-3.5" /> Release
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buy a number</CardTitle>
          <CardDescription>
            Choose a country, optionally filter by area code or digits,
            then pick a number from Twilio's inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr,120px,1fr,auto]">
            <div>
              <Label className="text-xs">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.countries.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.flag} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Area code</Label>
              <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ''))} maxLength={5} placeholder="415" />
            </div>
            <div>
              <Label className="text-xs">Contains</Label>
              <Input value={contains} onChange={(e) => setContains(e.target.value)} maxLength={20} placeholder="e.g. 7777" />
            </div>
            <div className="flex items-end">
              <Button onClick={runSearch} disabled={search.isFetching} className="h-10">
                {search.isFetching ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                Search
              </Button>
            </div>
          </div>

          {committed ? (
            <div className="rounded-lg border bg-card">
              {search.isLoading ? (
                <div className="p-4"><Skeleton className="h-28 w-full" /></div>
              ) : search.data?.numbers.length ? (
                <>
                  <ul className="divide-y">
                    {search.data.numbers.map((n) => (
                      <li key={n.phoneNumber} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Phone className="size-3.5 text-muted-foreground" />
                            <span className="font-mono text-sm">{n.phoneNumber}</span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {n.type}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {[n.locality, n.region, n.isoCountry].filter(Boolean).join(' · ')}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {n.capabilities.sms ? <Cap tone="emerald">SMS</Cap> : null}
                            {n.capabilities.mms ? <Cap tone="sky">MMS</Cap> : null}
                            {n.capabilities.voice ? <Cap tone="violet">Voice</Cap> : null}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">{formatPriceCents(n.monthlyPriceCents)}</div>
                          {canManage ? (
                            <Button
                              size="sm"
                              className="mt-1"
                              disabled={startPurchase.isPending || n.monthlyPriceCents == null}
                              onClick={() =>
                                startPurchase.mutate({
                                  phoneNumber: n.phoneNumber,
                                  country: n.isoCountry,
                                  monthlyPriceCents: n.monthlyPriceCents!,
                                })
                              }
                            >
                              {startPurchase.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                              Buy
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                    <span>Page {page + 1}</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0 || search.isFetching}
                      >
                        <ChevronLeft className="size-4" /> Prev
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={search.isFetching || (search.data?.numbers.length ?? 0) < 10}
                      >
                        Next <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No numbers match. Try widening the filters or a different country.
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function AlphaSendersTab({
  canManage,
  data,
  onChanged,
}: {
  canManage: boolean;
  data: ListData;
  onChanged: () => void;
}): JSX.Element {
  const [senderId, setSenderId] = useState('');
  const [country, setCountry] = useState(data.alphaCountries[0]?.code ?? 'GB');

  const register = api.smsChannel.registerAlphaSender.useMutation({
    onSuccess: () => {
      toast.success('Sender ID registered.');
      setSenderId('');
      onChanged();
    },
    onError: (err) => toast.error(err.message ?? 'Could not register.'),
  });
  const del = api.smsChannel.deleteAlphaSender.useMutation({
    onSuccess: () => {
      toast.success('Sender ID removed.');
      onChanged();
    },
    onError: (err) => toast.error(err.message ?? 'Could not remove.'),
  });

  const senderValid = useMemo(() => /^[A-Za-z0-9]{1,11}$/.test(senderId), [senderId]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your sender IDs</CardTitle>
          <CardDescription>
            Brand names (1–11 alphanumeric) shown as the SMS sender in
            supported destinations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.alphaSenders.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No sender IDs yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="pb-2 pr-3">Sender ID</th>
                    <th className="pb-2 pr-3">Destination</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.alphaSenders.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2 pr-3 font-mono">{a.senderId}</td>
                      <td className="py-2 pr-3">{a.country}</td>
                      <td className="py-2 pr-3">
                        <StatusChip status={a.status} />
                      </td>
                      <td className="py-2 text-right">
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (!confirm(`Remove sender ID "${a.senderId}"?`)) return;
                              del.mutate({ id: a.id });
                            }}
                            disabled={del.isPending}
                          >
                            <Trash2 className="mr-1 size-3.5" /> Remove
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Register a new sender ID</CardTitle>
            <CardDescription>
              Alphanumeric sender IDs are supported in select countries
              only (UK, India, Australia, Germany, France, …). Not
              available for US or Canada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
              <div>
                <Label className="text-xs">Sender ID</Label>
                <Input
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                  placeholder="MSFT"
                  className="font-mono uppercase"
                  maxLength={11}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">1–11 letters/digits. No spaces or symbols.</p>
              </div>
              <div>
                <Label className="text-xs">Destination country</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.alphaCountries.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => register.mutate({ senderId, country })}
                  disabled={!senderValid || register.isPending}
                  className="h-10"
                >
                  {register.isPending ? (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1 size-4" />
                  )}
                  Register
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Cap({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'emerald' | 'sky' | 'violet';
}): JSX.Element {
  const toneClass: Record<typeof tone, string> = {
    emerald: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    sky: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
    violet: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  } as const;
  return (
    <span className={cn('inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', toneClass[tone])}>
      {children}
    </span>
  );
}

function StatusChip({ status }: { status: string }): JSX.Element {
  const toneClass: Record<string, string> = {
    APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    SUBMITTED: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
    PENDING_SUBMISSION: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  };
  const tone = toneClass[status] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', tone)}>
      {status === 'APPROVED' ? <Sparkles className="size-3" /> : null}
      {status.replace('_', ' ')}
    </span>
  );
}
