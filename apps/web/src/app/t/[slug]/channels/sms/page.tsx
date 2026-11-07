import { Phone } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata = { title: 'SMS channel' };

export default function SmsChannelPage(): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-muted text-muted-foreground">
            <Phone className="size-5" />
          </span>
          <div>
            <CardTitle>SMS</CardTitle>
            <CardDescription>
              Twilio-backed transactional + marketing SMS.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">Coming in Phase 6</p>
          <p className="mt-1 text-xs text-muted-foreground">
            SMS sending (Twilio bring-your-own) ships after email and
            WhatsApp are fully hardened. We'll notify you here when it's
            live.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
