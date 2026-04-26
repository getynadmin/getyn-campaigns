'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

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

/**
 * Bare-bones initial create. We collect the minimum fields needed to
 * persist a DRAFT; everything else lives on the campaign detail page.
 *
 * The "subject is required" rule is technically violated here — we POST
 * `subject = '(Untitled)'` so the schema is satisfied without forcing
 * the user to context-switch. They'll fill the real subject on the
 * detail page's settings card.
 */
export function CampaignNewClient({
  tenantSlug,
  tenantDefaults,
}: {
  tenantSlug: string;
  tenantDefaults: { fromName: string; fromEmail: string };
}): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [segmentId, setSegmentId] = useState<string>('');

  const segmentsQ = api.segments.list.useQuery({ limit: 50 });

  const create = api.campaign.create.useMutation({
    onSuccess: (row) => {
      toast.success('Draft created.');
      router.push(`/t/${tenantSlug}/campaigns/${row.id}`);
    },
    onError: (err) => toast.error(err.message ?? 'Could not create campaign.'),
  });

  const valid = name.trim().length > 0 && segmentId.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        create.mutate({
          name: name.trim(),
          type: 'EMAIL',
          segmentId,
          settings: {
            // Placeholder — user fills these on the detail page. The Zod
            // schema only requires non-empty subject, so we put a stub
            // marker the UI can detect and prompt the user to edit.
            subject: '(Untitled)',
            previewText: undefined,
            fromName: tenantDefaults.fromName,
            fromEmail:
              tenantDefaults.fromEmail || `noreply@getynmail.com`,
            replyTo: undefined,
            sendingDomainId: null,
            abTest: null,
            trackingEnabled: true,
          },
          // Empty Unlayer design — the editor handles a blank starting
          // canvas without complaint.
          designJson: {},
        });
      }}
      className="space-y-5"
    >
      <div className="space-y-2">
        <Label htmlFor="name">Internal name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. October newsletter"
        />
        <p className="text-xs text-muted-foreground">
          Only your team sees this. The recipient subject is set later.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="segment">Audience segment</Label>
        {segmentsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading segments…</p>
        ) : segmentsQ.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No segments yet — create one in{' '}
            <a
              className="underline"
              href={`/t/${tenantSlug}/segments`}
            >
              Segments
            </a>{' '}
            first.
          </p>
        ) : (
          <Select value={segmentId} onValueChange={setSegmentId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a segment" />
            </SelectTrigger>
            <SelectContent>
              {segmentsQ.data?.items.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.cachedCount !== null
                    ? ` · ~${s.cachedCount.toLocaleString()} contacts`
                    : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/t/${tenantSlug}/campaigns`)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || create.isPending}>
          {create.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : null}
          Create draft
        </Button>
      </div>
    </form>
  );
}
