'use client';

import { useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { api } from '@/lib/trpc';

/**
 * Phase 7 M5 — email preview pane.
 *
 * Fetches the server-rendered HTML for the current conversation's
 * design plan via tRPC. The parent component invalidates the query
 * after each turn so the preview updates as the agent works.
 *
 * Renders the HTML into a sandboxed iframe so styles can't leak into
 * the app shell and link clicks can't navigate the parent. Desktop /
 * mobile toggle just changes the iframe width.
 */
export function EmailPreviewPane({
  conversationId,
}: {
  conversationId: string;
}): JSX.Element {
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const { data, isLoading } = api.agent.renderEmailPreview.useQuery(
    { conversationId },
    { refetchOnWindowFocus: false },
  );

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Skeleton className="h-1/2 w-3/4" />
      </div>
    );
  }
  if (!data || data.blockCount === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          <p className="font-medium">No design yet</p>
          <p className="mt-1 text-xs">
            The agent will propose a design once you describe the campaign.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-1 border-b bg-card px-4 py-2">
        <button
          type="button"
          onClick={() => setWidth('desktop')}
          className={cn(
            'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors',
            width === 'desktop'
              ? 'bg-foreground text-background'
              : 'hover:bg-muted',
          )}
          title="Desktop"
          aria-label="Desktop preview"
        >
          <Monitor className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setWidth('mobile')}
          className={cn(
            'grid size-7 place-items-center rounded-md text-muted-foreground transition-colors',
            width === 'mobile'
              ? 'bg-foreground text-background'
              : 'hover:bg-muted',
          )}
          title="Mobile"
          aria-label="Mobile preview"
        >
          <Smartphone className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div
          className={cn(
            'mx-auto bg-white shadow-md transition-all',
            width === 'desktop' ? 'max-w-[640px]' : 'max-w-[360px]',
          )}
        >
          <iframe
            sandbox="allow-same-origin"
            title="Email preview"
            srcDoc={data.html}
            className="block h-[80vh] w-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
