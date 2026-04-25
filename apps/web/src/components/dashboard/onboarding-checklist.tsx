'use client';

import Link from 'next/link';
import {
  Check,
  Circle,
  Filter,
  MessagesSquare,
  UserPlus,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type Step = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
  /** When true the step renders a muted "coming soon" pill instead of a link. */
  disabled?: boolean;
};

/**
 * Workspace onboarding. Reflects what's actually shippable today: invite
 * teammates, build the audience (contacts + segments), then connect a
 * channel. The channel step stays disabled until Phase 3 lands the send
 * pipeline.
 *
 * The "done" predicate for each step is intentionally simple — `count > 0` —
 * because we want the checklist to feel responsive after the first action,
 * not gated on a fancier completeness rule.
 */
export function OnboardingChecklist({
  tenantSlug,
  teamSize,
  contactsCount,
  segmentsCount,
}: {
  tenantSlug: string;
  teamSize: number;
  contactsCount: number;
  segmentsCount: number;
}): JSX.Element {
  const steps: Step[] = [
    {
      key: 'invite',
      title: 'Invite your team',
      description:
        'Add teammates so nobody gets bottlenecked on one person.',
      href: `/t/${tenantSlug}/settings/team`,
      cta: teamSize > 1 ? 'Manage team' : 'Invite',
      icon: UserPlus,
      done: teamSize > 1,
    },
    {
      key: 'contacts',
      title: 'Add your contacts',
      description:
        'Add people one-by-one or import a CSV — segments and sends start here.',
      href: `/t/${tenantSlug}/contacts`,
      cta: contactsCount > 0 ? 'Manage contacts' : 'Add contacts',
      icon: Users,
      done: contactsCount > 0,
    },
    {
      key: 'segment',
      title: 'Build a segment',
      description:
        'Slice your audience by tag, status, or any custom field — saved for reuse in campaigns.',
      href: `/t/${tenantSlug}/segments`,
      cta: segmentsCount > 0 ? 'View segments' : 'Create segment',
      icon: Filter,
      done: segmentsCount > 0,
    },
    {
      key: 'channel',
      title: 'Connect a sending channel',
      description:
        'Hook up email, WhatsApp, or SMS. Unlocks in Phase 3.',
      href: `/t/${tenantSlug}/settings/channels`,
      cta: 'Coming soon',
      icon: MessagesSquare,
      done: false,
      disabled: true,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Get started</h2>
          <p className="text-sm text-muted-foreground">
            A short path from empty workspace to your first campaign.
          </p>
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {doneCount} / {steps.length}
        </span>
      </div>
      <ul className="space-y-2">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={cn(
                'flex items-center gap-4 rounded-lg border p-4 transition-colors',
                step.done ? 'border-primary/30 bg-primary/5' : 'border-border',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full',
                  step.done
                    ? 'bg-primary text-primary-foreground'
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
                <p className="font-medium">{step.title}</p>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
              {step.disabled ? (
                <span className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {step.cta}
                </span>
              ) : (
                <Link
                  href={step.href}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    step.done
                      ? 'text-muted-foreground hover:text-foreground'
                      : 'bg-foreground text-background hover:bg-foreground/90',
                  )}
                >
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Re-exported so stub usages in other files get the same icon.
export { Circle };
