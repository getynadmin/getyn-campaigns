import Link from 'next/link';
import { ArrowRight, Bot, Workflow } from 'lucide-react';

/**
 * Upsell under the one-shot campaign builders: points users at
 * drip flows and autonomous agents if a single blast isn't what they
 * actually want. Soft gradient surface + colored tag chips so it
 * reads as a genuine recommendation rather than a muted afterthought,
 * without competing with the primary form.
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
    <div className="relative overflow-hidden rounded-xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-sky-50 to-violet-50 p-5 shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/40 dark:via-sky-950/30 dark:to-violet-950/40">
      {/* Decorative blur accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-500/10"
      />
      <div className="relative">
        <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
          Prefer an ongoing flow?
        </p>
        <p className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
          A one-shot campaign fires once. For automated sequences or
          hands-off replies, try one of these instead.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/t/${tenantSlug}/automation/drip/new`}
            className="group inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-sky-900 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-100 dark:hover:bg-sky-900/60"
          >
            <Workflow className="size-3.5" />
            Drip campaign
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href={autonomousHref}
            className="group inline-flex items-center gap-2 rounded-full border border-violet-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-violet-900 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/60"
          >
            <Bot className="size-3.5" />
            Autonomous agent
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
