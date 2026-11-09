'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Filter,
  Mail,
  MessageSquare,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type Step = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
};

/**
 * Workspace onboarding — the five essentials for a day-1 user. The
 * checklist is skippable per-step and dismissible as a whole: once
 * at least one step is complete it folds down to a slim progress bar
 * so it never blocks the real dashboard. Dismissal and skip state
 * are persisted per-user-per-tenant via `dashboardPrefs`.
 *
 * `done` for each step is intentionally lightweight — `count > 0` or
 * a boolean handed in — so the bar feels responsive to the first
 * action without waiting on a richer completeness rule.
 */
export function OnboardingChecklist({
  tenantSlug,
  contactsCount,
  segmentsCount,
  campaignsCount,
  hasVerifiedSendingDomain,
  hasConnectedWhatsapp,
}: {
  tenantSlug: string;
  contactsCount: number;
  segmentsCount: number;
  campaignsCount: number;
  hasVerifiedSendingDomain: boolean;
  hasConnectedWhatsapp: boolean;
}): JSX.Element | null {
  const prefs = api.dashboardPrefs.get.useQuery();
  const utils = api.useUtils();
  const skipStep = api.dashboardPrefs.skipOnboardingStep.useMutation({
    onSuccess: () => utils.dashboardPrefs.get.invalidate(),
  });
  const dismiss = api.dashboardPrefs.dismissOnboarding.useMutation({
    onSuccess: () => utils.dashboardPrefs.get.invalidate(),
  });
  const setCollapsed = api.dashboardPrefs.setOnboardingCollapsed.useMutation({
    onSuccess: () => utils.dashboardPrefs.get.invalidate(),
  });

  const allSteps = useMemo<Step[]>(
    () => [
      {
        key: 'sending-domain',
        title: 'Verify your sending domain',
        description:
          'Verify a domain you own so email lands in inboxes instead of spam.',
        href: `/t/${tenantSlug}/channels/email`,
        cta: hasVerifiedSendingDomain ? 'Done' : 'Verify domain',
        icon: ShieldCheck,
        done: hasVerifiedSendingDomain,
      },
      {
        key: 'contacts',
        title: 'Add your contacts',
        description:
          'Import a CSV or add people one-by-one. Segments and sends start here.',
        href: `/t/${tenantSlug}/contacts`,
        cta: contactsCount > 0 ? 'Manage contacts' : 'Add contacts',
        icon: Users,
        done: contactsCount > 0,
      },
      {
        key: 'segment',
        title: 'Create your first segment',
        description:
          'Slice your audience by tag, status, or any custom field for targeted sends.',
        href: `/t/${tenantSlug}/segments`,
        cta: segmentsCount > 0 ? 'View segments' : 'Create segment',
        icon: Filter,
        done: segmentsCount > 0,
      },
      {
        key: 'whatsapp',
        title: 'Connect WhatsApp',
        description:
          'Bring your own WABA via Meta Business Manager to send templated messages.',
        href: `/t/${tenantSlug}/channels/whatsapp`,
        cta: hasConnectedWhatsapp ? 'Manage WhatsApp' : 'Connect',
        icon: MessageSquare,
        done: hasConnectedWhatsapp,
      },
      {
        key: 'campaign',
        title: 'Send your first campaign',
        description:
          'Pick a segment, design in the drag-and-drop builder, send. Analytics come free.',
        href: `/t/${tenantSlug}/campaigns/new`,
        cta: campaignsCount > 0 ? 'View campaigns' : 'Create campaign',
        icon: Mail,
        done: campaignsCount > 0,
      },
    ],
    [
      tenantSlug,
      contactsCount,
      segmentsCount,
      campaignsCount,
      hasVerifiedSendingDomain,
      hasConnectedWhatsapp,
    ],
  );

  const skipped = prefs.data?.onboardingSkipped ?? [];
  const steps = allSteps.filter((s) => !skipped.includes(s.key));
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length === 0 || doneCount === steps.length;

  // Collapsed by default when at least one step is complete. Users
  // can toggle explicitly via the chevron and that choice is
  // persisted — server pref wins over the heuristic.
  const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null);
  const serverCollapsed = prefs.data?.onboardingCollapsed;
  const effectiveCollapsed =
    localCollapsed ?? serverCollapsed ?? doneCount > 0;

  if (prefs.data?.onboardingDismissed) return null;
  if (steps.length === 0) return null;
  if (allDone) return null;

  const progress = steps.length === 0 ? 0 : (doneCount / steps.length) * 100;

  const toggle = (): void => {
    const next = !effectiveCollapsed;
    setLocalCollapsed(next);
    setCollapsed.mutate({ collapsed: next });
  };

  return (
    <section className="overflow-hidden rounded-xl border bg-gradient-to-br from-emerald-50/70 via-white to-lime-50/40 shadow-sm dark:from-emerald-950/30 dark:via-card dark:to-lime-950/20">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
        aria-expanded={!effectiveCollapsed}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
          <Check className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-semibold">
              Getting started
            </h2>
            <span className="text-xs text-muted-foreground">
              — {doneCount} of {steps.length} complete
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {effectiveCollapsed ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            dismiss.mutate(undefined, {
              onSuccess: () => toast.success('Checklist dismissed.'),
            });
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            dismiss.mutate();
          }}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label="Dismiss onboarding checklist"
          title="Dismiss"
        >
          <X className="size-3.5" />
        </span>
      </button>

      {!effectiveCollapsed && (
        <ul className="divide-y divide-black/5 border-t border-black/5 dark:divide-white/10 dark:border-white/10">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li
                key={step.key}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              >
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full',
                    step.done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {step.done ? (
                    <Check className="size-4" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                {!step.done && (
                  <button
                    type="button"
                    onClick={() =>
                      skipStep.mutate(
                        { key: step.key },
                        {
                          onSuccess: () =>
                            toast.success(`Skipped "${step.title}".`),
                        },
                      )
                    }
                    className="hidden rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
                  >
                    Skip
                  </button>
                )}
                <Link
                  href={step.href}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    step.done
                      ? 'text-muted-foreground hover:text-foreground'
                      : 'bg-foreground text-background hover:bg-foreground/90',
                  )}
                >
                  {step.cta}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Re-exported so stub usages in other files get the same icon.
export { Circle };
