'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowRight,
  Loader2,
  Mail,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/trpc';

/**
 * Phase 7 M5 — campaign-creation chooser.
 *
 * Replaces the bare CampaignNewClient form. Tenants now pick between
 * (a) the AI Campaign Agent (gradient card on top) or (b) the manual
 * flows (existing email-only form, linked at smaller weight).
 *
 * Clicking the AI card opens a Channel picker; selecting Email or
 * WhatsApp calls agent.startConversation and routes into the chat.
 *
 * Brand-profile-incomplete is enforced server-side at startConversation;
 * we surface the resulting tRPC error as a toast with a link to the
 * brand settings page.
 */
export function NewCampaignChooser({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const router = useRouter();
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);

  const start = api.agent.startConversation.useMutation({
    onSuccess: ({ conversationId }) => {
      router.push(`/t/${tenantSlug}/agent/${conversationId}`);
    },
    onError: (err) => {
      // Brand-incomplete and plan-limit cases land here with friendly
      // server-side messages; we surface them verbatim with a toast.
      toast.error(err.message);
      setChannelPickerOpen(false);
    },
  });

  return (
    <div className="space-y-5">
      {/* AI Agent — primary CTA */}
      <button
        type="button"
        onClick={() => setChannelPickerOpen(true)}
        className="group block w-full rounded-2xl border border-violet-300/40 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 p-[1.5px] shadow-lg shadow-fuchsia-500/15 transition-all hover:shadow-xl"
      >
        <div className="rounded-[15px] bg-white/95 p-5 transition-colors group-hover:bg-white dark:bg-zinc-950/95 dark:group-hover:bg-zinc-950">
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-md">
              <Sparkles className="size-6" />
            </span>
            <div className="min-w-0 flex-1 text-left">
              <p className="font-display text-base font-semibold">
                Create with AI Agent
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Chat through it — the agent drafts the campaign, you review
                and tweak in the editor before sending.
              </p>
            </div>
            <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </button>

      {/* Manual options — secondary */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Or build manually
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`/t/${tenantSlug}/campaigns/new/email`}
            className="group rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                <Mail className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Build email manually</p>
                <p className="text-xs text-muted-foreground">
                  Name + segment, then the editor.
                </p>
              </div>
            </div>
          </Link>
          <Link
            href={`/t/${tenantSlug}/whatsapp/campaigns/new`}
            className="group rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <MessageCircle className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Build WhatsApp manually</p>
                <p className="text-xs text-muted-foreground">
                  Pick an approved template + segment.
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Channel-picker dialog */}
      <Dialog open={channelPickerOpen} onOpenChange={setChannelPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which channel?</DialogTitle>
            <DialogDescription>
              The agent's tools differ by channel — pick one to get
              started.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <ChannelCard
              icon={<Mail className="size-5" />}
              label="Email"
              hint="Hero blocks, copy, CTAs"
              onClick={() => start.mutate({ channel: 'EMAIL' })}
              disabled={start.isPending}
            />
            <ChannelCard
              icon={<MessageCircle className="size-5" />}
              label="WhatsApp"
              hint="Template + variables"
              onClick={() => start.mutate({ channel: 'WHATSAPP' })}
              disabled={start.isPending}
            />
          </div>
          {start.isPending && (
            <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Starting conversation…
            </div>
          )}
          <div className="border-t pt-3 text-xs text-muted-foreground">
            <Button asChild variant="ghost" size="sm" className="h-auto p-0 text-xs">
              <Link href={`/t/${tenantSlug}/agent`}>
                Or resume an earlier conversation
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChannelCard({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-start gap-2 rounded-lg border bg-background p-4 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/30 disabled:opacity-60 dark:hover:bg-violet-950/20"
    >
      <span className="grid size-9 place-items-center rounded-md bg-muted text-foreground">
        {icon}
      </span>
      <span className="font-medium text-sm">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
