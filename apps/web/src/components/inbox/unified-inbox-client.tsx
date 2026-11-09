'use client';

import { useState } from 'react';
import { Mail, MessageSquare } from 'lucide-react';

import { cn } from '@/lib/utils';

import { EmailInboxClient } from '@/components/email-inbox/email-inbox-client';

import { InboxClient } from './inbox-client';

type Tab = 'whatsapp' | 'email';

/**
 * Two tabs over the existing inbox clients. No logic changes to
 * either child — they're mounted as-is under whichever tab is active.
 */
export function UnifiedInboxClient({
  tenantSlug,
  initialTab,
  currentUser,
  canCloseReopen,
}: {
  tenantSlug: string;
  initialTab: Tab;
  currentUser: { id: string; name: string };
  canCloseReopen: boolean;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b bg-background px-4">
        <TabButton
          active={tab === 'whatsapp'}
          onClick={() => setTab('whatsapp')}
          icon={<MessageSquare className="size-4" />}
          label="WhatsApp"
        />
        <TabButton
          active={tab === 'email'}
          onClick={() => setTab('email')}
          icon={<Mail className="size-4" />}
          label="Email"
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'whatsapp' ? (
          <InboxClient
            tenantSlug={tenantSlug}
            currentUser={currentUser}
            canCloseReopen={canCloseReopen}
          />
        ) : (
          <EmailInboxClient />
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
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors',
        active
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
