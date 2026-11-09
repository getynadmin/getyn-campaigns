'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bot, Mail, MessageSquare, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { EmailAgentsListClient } from '@/components/email-agent/agents-list-client';
import { WhatsappAgentsListClient } from '@/components/whatsapp-agent/agents-list-client';

type Tab = 'email' | 'whatsapp';

/**
 * Two tabs host the existing per-channel agent list clients as-is;
 * no changes to those lists' behaviour. The colored channel tag the
 * spec calls for is painted next to the tab titles so operators
 * always know which bucket they're looking at; the lists themselves
 * only ever show one channel at a time so there's nothing to tag
 * at the row level today.
 */
export function AutonomousCampaignsClient({
  slug,
  initialTab,
}: {
  slug: string;
  initialTab: Tab;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Bot className="size-5" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Autonomous Campaigns
            </h1>
            <p className="text-sm text-muted-foreground">
              Claude-brained agents that handle inbound email and WhatsApp
              threads on your behalf.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link
            href={
              tab === 'email'
                ? `/t/${slug}/automation/agents/new`
                : `/t/${slug}/automation/whatsapp-agents/new`
            }
          >
            <Plus className="mr-1 size-4" />
            New {tab === 'email' ? 'Email' : 'WhatsApp'} agent
          </Link>
        </Button>
      </div>

      <div className="flex gap-1 border-b">
        <TabButton
          active={tab === 'email'}
          onClick={() => setTab('email')}
          icon={<Mail className="size-4" />}
          label="Email agents"
          tagClass="bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
          tag="Email"
        />
        <TabButton
          active={tab === 'whatsapp'}
          onClick={() => setTab('whatsapp')}
          icon={<MessageSquare className="size-4" />}
          label="WhatsApp agents"
          tagClass="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          tag="WhatsApp"
        />
      </div>

      <div>
        {tab === 'email' ? (
          <EmailAgentsListClient slug={slug} />
        ) : (
          <WhatsappAgentsListClient slug={slug} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  tag,
  tagClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
  tag: string;
  tagClass: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors',
        active
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
          tagClass,
        )}
      >
        {tag}
      </span>
    </button>
  );
}
