import Link from 'next/link';
import { ArrowRight, Bot, Workflow } from 'lucide-react';

/**
 * Quiet upsell under the one-shot campaign builders: points users at
 * drip flows and autonomous agents if a single blast isn't what they
 * actually want. Deliberately muted — subtle border, muted text, not
 * competing with the primary form.
 */
export function OngoingFlowUpsell({
  tenantSlug,
  channel,
}: {
  tenantSlug: string;
  channel: 'email' | 'whatsapp';
}): JSX.Element {
  const autonomousHref =
    channel === 'whatsapp'
      ? `/t/${tenantSlug}/automation/autonomous?tab=whatsapp`
      : `/t/${tenantSlug}/automation/autonomous?tab=email`;

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-4">
      <p className="text-sm font-medium">Prefer an ongoing flow?</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        A one-shot campaign fires once. For automated sequences or
        hands-off replies, try one of these instead.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/t/${tenantSlug}/automation/drip/new`}
          className="group inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Workflow className="size-3.5 text-muted-foreground" />
          Drip campaign
          <ArrowRight className="size-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href={autonomousHref}
          className="group inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Bot className="size-3.5 text-muted-foreground" />
          Autonomous agent
          <ArrowRight className="size-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
