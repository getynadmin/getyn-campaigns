'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Tag as TagIcon,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import type { ContactEventType } from '@getyn/db';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Activity timeline for a single contact.
 *
 * Backed by the dedicated `events.list` tRPC query so we can paginate
 * beyond the 50 events `contacts.get` preloads. Pages append into a local
 * accumulator so "Load more" extends the visible list rather than
 * replacing it — there's no useful "previous" semantics for a strictly
 * descending timeline.
 *
 * Visual treatment is event-type-aware: each event type gets an icon and
 * a tone so the timeline is scannable. Status flips also surface their
 * source channel from `metadata.channel` so "Unsubscribed" reads as
 * "Unsubscribed on email" instead of the bare label.
 */

type IconConfig = {
  icon: LucideIcon;
  tone: string;
};

const TYPE_ICON: Partial<Record<ContactEventType, IconConfig>> = {
  CREATED: { icon: UserPlus, tone: 'text-emerald-600' },
  UPDATED: { icon: Pencil, tone: 'text-muted-foreground' },
  IMPORTED: { icon: Plus, tone: 'text-sky-600' },
  TAG_ADDED: { icon: TagIcon, tone: 'text-violet-600' },
  TAG_REMOVED: { icon: TagIcon, tone: 'text-muted-foreground' },
  SUBSCRIBED: { icon: RefreshCw, tone: 'text-emerald-600' },
  UNSUBSCRIBED: { icon: RefreshCw, tone: 'text-muted-foreground' },
  BOUNCED: { icon: Mail, tone: 'text-amber-600' },
  COMPLAINED: { icon: Mail, tone: 'text-rose-600' },
  EMAIL_SENT: { icon: Mail, tone: 'text-sky-600' },
  EMAIL_DELIVERED: { icon: Mail, tone: 'text-sky-600' },
  EMAIL_OPENED: { icon: Mail, tone: 'text-emerald-600' },
  EMAIL_CLICKED: { icon: Mail, tone: 'text-emerald-700' },
  SMS_SENT: { icon: MessageSquare, tone: 'text-sky-600' },
  SMS_DELIVERED: { icon: MessageSquare, tone: 'text-sky-600' },
  WHATSAPP_SENT: { icon: MessageSquare, tone: 'text-emerald-600' },
  WHATSAPP_DELIVERED: { icon: MessageSquare, tone: 'text-emerald-600' },
  WHATSAPP_READ: { icon: MessageSquare, tone: 'text-emerald-700' },
};

const PAGE_SIZE = 25;

type EventRow = {
  id: string;
  type: ContactEventType;
  occurredAt: Date | string;
  metadata: unknown;
};

export function ActivityTimeline({
  contactId,
}: {
  contactId: string;
}): JSX.Element {
  // `cursor` is the cursor for the *next* page to fetch. `accumulated` keeps
  // every event we've already merged in. We dedupe by id so React Query's
  // background refetch on the same cursor never produces ghost duplicates.
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<EventRow[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const lastContactRef = useRef<string>(contactId);

  // Reset when navigating between contacts (same component, different id).
  if (lastContactRef.current !== contactId) {
    lastContactRef.current = contactId;
    seenRef.current = new Set();
    if (accumulated.length > 0) setAccumulated([]);
    if (cursor !== undefined) setCursor(undefined);
  }

  const { data, isLoading, isFetching } = api.events.list.useQuery({
    contactId,
    limit: PAGE_SIZE,
    cursor,
  });

  // Merge each page's items into the accumulator. We run this in an effect
  // so React Query's caching layer can render synchronously without
  // triggering an in-render setState.
  useEffect(() => {
    if (!data?.items?.length) return;
    const additions: EventRow[] = [];
    for (const row of data.items) {
      if (!seenRef.current.has(row.id)) {
        seenRef.current.add(row.id);
        additions.push(row);
      }
    }
    if (additions.length > 0) {
      setAccumulated((prev) => [...prev, ...additions]);
    }
  }, [data]);

  const hasMore = data?.nextCursor != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && accumulated.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : accumulated.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {accumulated.map((e) => {
              const cfg = TYPE_ICON[e.type] ?? {
                icon: Pencil,
                tone: 'text-muted-foreground',
              };
              const Icon = cfg.icon;
              const summary = summarise(e.metadata);
              return (
                <li key={e.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted',
                      cfg.tone,
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {humanLabel(e.type, e.metadata)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleString()}
                      {summary ? (
                        <>
                          <span className="mx-1.5">·</span>
                          {summary}
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {hasMore ? (
          <div className="mt-3 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={isFetching}
              onClick={() => {
                if (data?.nextCursor) setCursor(data.nextCursor);
              }}
            >
              {isFetching ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : null}
              Load more
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanLabel(type: ContactEventType, metadata: unknown): string {
  const base = type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
  const channel = readMetadataChannel(metadata);
  if (
    channel &&
    (type === 'SUBSCRIBED' ||
      type === 'UNSUBSCRIBED' ||
      type === 'BOUNCED' ||
      type === 'COMPLAINED')
  ) {
    return `${base} on ${channel.toLowerCase()}`;
  }
  return base;
}

function summarise(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  if (Array.isArray(m.changed) && m.changed.length > 0) {
    const list = m.changed.slice(0, 3).join(', ');
    return `Changed: ${list}${m.changed.length > 3 ? '…' : ''}`;
  }
  if (typeof m.tagName === 'string') return `Tag: ${m.tagName}`;
  if (typeof m.via === 'string') return m.via;
  return null;
}

function readMetadataChannel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const c = (metadata as Record<string, unknown>).channel;
  return typeof c === 'string' ? c : null;
}
