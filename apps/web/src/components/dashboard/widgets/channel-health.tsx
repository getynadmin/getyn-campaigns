'use client';

import Link from 'next/link';
import { ArrowRight, Check, Mail, MessageSquare, Phone, X } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Channel health — three mini chips showing email / WhatsApp / SMS
 * connection state. Each row is a link to the channel's config page
 * when not connected so the next action is one click away.
 */
export function ChannelHealthWidget({ tenantSlug }: { tenantSlug: string; days: number }): JSX.Element {
  const { data, isLoading } = api.dashboardPrefs.channelStatus.useQuery();
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }
  const rows = [
    {
      key: 'email',
      label: 'Email',
      sub: data?.email.connected
        ? `${data.email.verifiedDomains} verified domain${data.email.verifiedDomains === 1 ? '' : 's'}`
        : 'No verified sending domain',
      icon: Mail,
      connected: data?.email.connected ?? false,
      href: `/t/${tenantSlug}/channels/email`,
      color: 'sky',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      sub: data?.whatsapp.connected ? 'WABA connected' : 'Not connected',
      icon: MessageSquare,
      connected: data?.whatsapp.connected ?? false,
      href: `/t/${tenantSlug}/channels/whatsapp`,
      color: 'emerald',
    },
    {
      key: 'sms',
      label: 'SMS',
      sub: data?.sms.connected ? 'Twilio enabled' : 'Platform SMS not configured',
      icon: Phone,
      connected: data?.sms.connected ?? false,
      href: `/t/${tenantSlug}/channels/sms`,
      color: 'amber',
    },
  ];
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <li key={r.key}>
            <Link
              href={r.href}
              className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-md',
                  r.color === 'sky' && 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
                  r.color === 'emerald' &&
                    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
                  r.color === 'amber' &&
                    'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{r.label}</p>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      r.connected
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {r.connected ? <Check className="size-2.5" /> : <X className="size-2.5" />}
                    {r.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{r.sub}</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
