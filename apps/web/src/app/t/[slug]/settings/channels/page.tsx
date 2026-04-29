import Link from 'next/link';
import { ArrowRight, Mail, MessageSquare, Phone } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata = { title: 'Channels' };

interface ChannelTile {
  name: string;
  description: string;
  icon: typeof Mail;
  href?: (slug: string) => string;
  cta: string;
}

const channels: ChannelTile[] = [
  {
    name: 'Email',
    description: 'Bring-your-own domain via Resend, plus the shared @getynmail.com pool.',
    icon: Mail,
    href: (slug: string): string => `/t/${slug}/settings/sending-domains`,
    cta: 'Configured',
  },
  {
    name: 'WhatsApp',
    description: 'Bring your own WABA via Meta Business Manager. Templates, inbox, polling status.',
    icon: MessageSquare,
    href: (slug: string): string => `/t/${slug}/settings/channels/whatsapp`,
    cta: 'Configure',
  },
  {
    name: 'SMS',
    description: 'Twilio-backed transactional + marketing SMS.',
    icon: Phone,
    cta: 'Phase 6',
  },
];

export default function ChannelsSettingsPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>
          Connected sending channels. Each channel is bring-your-own — credentials
          live in your accounts and we store the working tokens encrypted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {channels.map((c) => {
            const Icon = c.icon;
            const Inner = (
              <div className="flex h-full flex-col gap-2 rounded-lg border bg-card p-4 transition-colors group-hover:border-primary/40">
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <p className="font-medium">{c.name}</p>
                </div>
                <p className="text-sm text-muted-foreground">{c.description}</p>
                <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {c.cta}
                  {c.href && <ArrowRight className="size-3" />}
                </span>
              </div>
            );
            return c.href ? (
              <Link key={c.name} href={c.href(params.slug)} className="group">
                {Inner}
              </Link>
            ) : (
              <div key={c.name}>{Inner}</div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
