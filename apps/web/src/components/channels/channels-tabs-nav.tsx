'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, MessageSquare, Phone, type LucideIcon } from 'lucide-react';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type ChannelTab = {
  key: 'email' | 'whatsapp' | 'sms';
  label: string;
  icon: LucideIcon;
};

const TABS: ChannelTab[] = [
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { key: 'sms', label: 'SMS', icon: Phone },
];

/**
 * Subnav for the Channels section. Each tab shows a live status
 * badge driven by the same tRPC queries the pages themselves use —
 * green "Connected / Active" once credentials are live, muted "Not
 * connected" / "Soon" otherwise. Status comes from cached queries so
 * flipping tabs is instant.
 */
export function ChannelsTabsNav({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const pathname = usePathname() ?? '';
  const base = `/t/${tenantSlug}/channels`;

  const domains = api.sendingDomain.list.useQuery({});
  const waba = api.whatsAppAccount.get.useQuery();
  const sms = api.smsChannel.list.useQuery(undefined, {
    // Fail-open — don't thrash the sidebar if Twilio isn't configured yet.
    retry: false,
  });

  const emailConnected = (domains.data?.items ?? []).some(
    (d) => d.status === 'VERIFIED',
  );
  const whatsappConnected = waba.data?.status === 'CONNECTED';
  const smsConnected = Boolean(
    sms.data &&
      sms.data.twilioReady &&
      (sms.data.phoneNumbers.length > 0 ||
        sms.data.alphaSenders.some((a) => a.status === 'APPROVED')),
  );

  const statusFor = (
    key: ChannelTab['key'],
  ): { label: string; tone: 'green' | 'muted' | 'amber' } => {
    if (key === 'email')
      return emailConnected
        ? { label: 'Connected', tone: 'green' }
        : { label: 'Not connected', tone: 'muted' };
    if (key === 'whatsapp')
      return whatsappConnected
        ? { label: 'Connected', tone: 'green' }
        : { label: 'Not connected', tone: 'muted' };
    return smsConnected
      ? { label: 'Connected', tone: 'green' }
      : { label: 'Not connected', tone: 'muted' };
  };

  return (
    <div className="flex flex-wrap gap-1 border-b">
      {TABS.map((tab) => {
        const href = `${base}/${tab.key}`;
        const active = pathname.startsWith(href);
        const status = statusFor(tab.key);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {tab.label}
            <span
              className={cn(
                'ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                status.tone === 'green' &&
                  'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
                status.tone === 'muted' && 'bg-muted text-muted-foreground',
                status.tone === 'amber' &&
                  'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
              )}
            >
              {status.tone === 'green' ? (
                <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              ) : null}
              {status.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
