import { Server } from 'lucide-react';

export const metadata = { title: 'Queues · Staff' };

/**
 * Phase 5 M7 — placeholder.
 *
 * Lands real in M8 — BullMQ queue depth + failed-job inspector.
 * Today ops debug via Railway logs + Sentry; this surface is a
 * nice-to-have, not blocking.
 */
export default function QueuesPage(): JSX.Element {
  return (
    <div className="grid h-96 place-items-center rounded-lg border border-dashed bg-card text-center">
      <div>
        <Server className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">Queue dashboard</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Lands in M8 — BullMQ queue depths, failed-job inspector, retry
          button per failed job. For now use Railway logs + Sentry.
        </p>
      </div>
    </div>
  );
}
