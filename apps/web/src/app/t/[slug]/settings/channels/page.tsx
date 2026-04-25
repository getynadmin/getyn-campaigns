import { Mail, MessageSquare, Phone } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata = { title: 'Channels' };

const channels = [
  {
    name: 'Email',
    description: 'SendGrid, Mailgun, or bring your own SMTP.',
    icon: Mail,
  },
  {
    name: 'WhatsApp',
    description: 'Cloud API-backed sending for approved templates.',
    icon: MessageSquare,
  },
  {
    name: 'SMS',
    description: 'Twilio-backed transactional + marketing SMS.',
    icon: Phone,
  },
];

export default function ChannelsSettingsPage(): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>
          Connected sending channels. Setup flows land in the next phase.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {channels.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.name}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <p className="font-medium">{c.name}</p>
                </div>
                <p className="text-sm text-muted-foreground">{c.description}</p>
                <span className="mt-2 inline-flex w-fit rounded-md bg-muted px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Not connected
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
