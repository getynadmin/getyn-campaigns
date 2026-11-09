'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Phone, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const MERGE_TAGS = [
  'first_name',
  'last_name',
  'email',
  'phone',
];

/**
 * Very small SMS-segment estimator mirroring the server helper —
 * drives the live counter + "N segment(s)" hint. Doesn't need to be
 * byte-perfect; the worker recomputes at send time.
 */
function estimateSegments(body: string): {
  chars: number;
  encoding: 'GSM' | 'UCS2';
  segments: number;
} {
  const chars = [...body].length;
  let nonGsm = false;
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) > 0xff) {
      nonGsm = true;
      break;
    }
  }
  const encoding: 'GSM' | 'UCS2' = nonGsm ? 'UCS2' : 'GSM';
  if (chars === 0) return { chars: 0, encoding, segments: 0 };
  const single = encoding === 'GSM' ? 160 : 70;
  const concat = encoding === 'GSM' ? 153 : 67;
  const segments = chars <= single ? 1 : Math.ceil(chars / concat);
  return { chars, encoding, segments };
}

export function SmsCampaignNewClient({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const router = useRouter();

  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState<string>('');
  const [body, setBody] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const segments = api.segments.list.useQuery({ limit: 100 });
  const create = api.smsCampaign.create.useMutation();
  const sendNow = api.smsCampaign.sendNow.useMutation();
  const schedule = api.smsCampaign.schedule.useMutation();

  const counter = useMemo(() => estimateSegments(body), [body]);
  const busy =
    create.isPending || sendNow.isPending || schedule.isPending;

  function insertTag(tag: string): void {
    setBody((prev) => `${prev}{{${tag}}}`);
  }

  async function onSubmit(mode: 'now' | 'schedule'): Promise<void> {
    if (!name.trim() || !segmentId || !body.trim()) {
      toast.error('Fill in name, segment and message body.');
      return;
    }
    if (mode === 'schedule' && !scheduledAt) {
      toast.error('Pick a schedule date/time.');
      return;
    }
    try {
      const campaign = await create.mutateAsync({
        name: name.trim(),
        segmentId,
        body: body.trim(),
        fromNumber: fromNumber.trim() || undefined,
      });
      if (mode === 'now') {
        await sendNow.mutateAsync({ id: campaign.id });
        toast.success('SMS campaign queued for immediate send.');
      } else {
        await schedule.mutateAsync({
          id: campaign.id,
          scheduledAt: new Date(scheduledAt).toISOString(),
        });
        toast.success('SMS campaign scheduled.');
      }
      router.push(`/t/${tenantSlug}/campaigns`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not create SMS campaign.',
      );
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/t/${tenantSlug}/campaigns`)}
          >
            <ArrowLeft className="mr-1 size-4" />
            Campaigns
          </Button>
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
              <Phone className="size-5 text-amber-500" />
              New SMS campaign
            </h1>
            <p className="text-sm text-muted-foreground">
              Broadcast a text message to a contact segment via your
              configured Twilio number.
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="space-y-1">
          <Label>Campaign name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="November promo blast"
          />
        </div>

        <div className="space-y-1">
          <Label>Audience segment</Label>
          <Select value={segmentId} onValueChange={setSegmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a segment" />
            </SelectTrigger>
            <SelectContent>
              {(segments.data?.items ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>Message</Label>
            <div className="text-xs text-muted-foreground">
              {counter.chars} chars ·{' '}
              <span
                className={cn(
                  counter.segments > 1 && 'font-medium text-amber-600',
                )}
              >
                {counter.segments || 0} segment
                {counter.segments === 1 ? '' : 's'}
              </span>{' '}
              · {counter.encoding}
            </div>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={1600}
            placeholder="Hey {{first_name}}, our Black Friday sale just went live — enjoy 25% off everything."
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap gap-1 pt-1">
            {MERGE_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => insertTag(t)}
                className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {`{{${t}}}`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label>From number or Messaging-Service SID (optional)</Label>
          <Input
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="Leave blank to use the platform default"
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label>Schedule (optional)</Label>
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Leave blank to send immediately.
          </p>
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          SMS is billed per segment — long messages split into multiple
          segments count against your monthly allowance.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || !scheduledAt}
            onClick={() => onSubmit('schedule')}
          >
            {schedule.isPending ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : null}
            Schedule
          </Button>
          <Button disabled={busy} onClick={() => onSubmit('now')}>
            {sendNow.isPending || create.isPending ? (
              <Loader2 className="mr-1 size-4 animate-spin" />
            ) : (
              <Send className="mr-1 size-4" />
            )}
            Send now
          </Button>
        </div>
      </div>
    </div>
  );
}
