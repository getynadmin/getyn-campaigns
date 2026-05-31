'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

/**
 * Form-backed view of the AppSettings singleton. We hydrate from the
 * server query once on load, then track local state — saving sends the
 * full payload. Optimistic UI isn't worth the complexity for a
 * once-in-a-while config page.
 */
export function AdminAppSettingsClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data: settings, isLoading } = adminApi.appSettings.get.useQuery();
  const { data: plans } = adminApi.plan.list.useQuery();

  const [defaultPlanId, setDefaultPlanId] = useState<string | null>(null);
  const [autoAssign, setAutoAssign] = useState(false);
  const [allowUpgrade, setAllowUpgrade] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local state once when the server data arrives.
  useEffect(() => {
    if (!settings || hydrated) return;
    setDefaultPlanId(settings.defaultPlanId ?? null);
    setAutoAssign(settings.defaultPlanAutoAssign);
    setAllowUpgrade(settings.allowUpgradeRequests);
    setHydrated(true);
  }, [settings, hydrated]);

  const save = adminApi.appSettings.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      void utils.appSettings.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !settings) {
    return <Skeleton className="h-64" />;
  }

  const eligiblePlans = (plans ?? []).filter((p) => !p.isArchived);
  // Auto-assign without a default plan is invalid on the server, so
  // mirror that here for a tighter UX.
  const canEnableAutoAssign = !!defaultPlanId;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Default plan</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Optional. When set + auto-assign is enabled, new tenants get a
            Subscription on this plan automatically. Without auto-assign, the
            default is a recommendation only.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Plan</Label>
          <Select
            value={defaultPlanId ?? '__none__'}
            onValueChange={(v) =>
              setDefaultPlanId(v === '__none__' ? null : v)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {eligiblePlans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ({p.slug})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={autoAssign}
            disabled={!canEnableAutoAssign}
            onChange={(e) => setAutoAssign(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Auto-assign to new tenants</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {canEnableAutoAssign
                ? 'New tenants get this plan on first sign-in.'
                : 'Pick a default plan above to enable.'}
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Upgrade requests</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tenants on a plan can request to move up. When disabled, the
            upgrade button is hidden tenant-side.
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            checked={allowUpgrade}
            onChange={(e) => setAllowUpgrade(e.target.checked)}
            className="mt-0.5 size-4 accent-foreground"
          />
          <span>
            <span className="font-medium">Accept upgrade requests</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Requests land in the staff review queue.
            </span>
          </span>
        </label>
      </section>

      <div className="md:col-span-2 flex justify-end">
        <Button
          onClick={() =>
            save.mutate({
              defaultPlanId,
              defaultPlanAutoAssign: autoAssign && canEnableAutoAssign,
              allowUpgradeRequests: allowUpgrade,
            })
          }
          disabled={save.isPending}
        >
          {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}
