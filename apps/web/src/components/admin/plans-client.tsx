'use client';

import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';

import { PlanMetric } from '@getyn/db';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

/**
 * Phase 5.5 M2 — plans admin.
 *
 * Single page lists all plans (active + archived) with inline actions.
 * Editing happens in a dialog rather than a detail route so that the
 * features grid stays adjacent to the plan fields.
 *
 * The form state is a flat object — feature rows are keyed by metric
 * so the diff on the server side stays straightforward. We expose every
 * PlanMetric value so omitting one means "this plan doesn't offer that
 * feature" (zero or unlimited).
 */

const METRICS: PlanMetric[] = [
  PlanMetric.CONTACTS,
  PlanMetric.EMAILS_PER_MONTH,
  PlanMetric.WA_MESSAGES_PER_MONTH,
  PlanMetric.SMS_SEGMENTS_PER_MONTH,
  PlanMetric.AI_CREDITS_PER_MONTH,
  PlanMetric.CUSTOM_SENDING_DOMAINS,
  PlanMetric.USER_SEATS,
  PlanMetric.AI_AGENT_CONVERSATIONS_PER_MONTH,
];

const METRIC_LABEL: Record<PlanMetric, string> = {
  CONTACTS: 'Contacts',
  EMAILS_PER_MONTH: 'Emails / month',
  WA_MESSAGES_PER_MONTH: 'WhatsApp msgs / month',
  SMS_SEGMENTS_PER_MONTH: 'SMS segments / month',
  AI_CREDITS_PER_MONTH: 'AI credits / month',
  CUSTOM_SENDING_DOMAINS: 'Custom sending domains',
  USER_SEATS: 'User seats',
  AI_AGENT_CONVERSATIONS_PER_MONTH: 'AI agent conversations / month',
};

type FormState = {
  id: string | null; // null = create
  slug: string;
  name: string;
  description: string;
  priceMonthlyCents: string; // strings to allow blank
  priceYearlyCents: string;
  currency: string;
  features: Record<PlanMetric, { included: string; overageCentsPer1k: string }>;
};

const EMPTY_FEATURES = (): FormState['features'] =>
  METRICS.reduce(
    (acc, m) => {
      acc[m] = { included: '0', overageCentsPer1k: '' };
      return acc;
    },
    {} as FormState['features'],
  );

const EMPTY_FORM = (): FormState => ({
  id: null,
  slug: '',
  name: '',
  description: '',
  priceMonthlyCents: '',
  priceYearlyCents: '',
  currency: 'USD',
  features: EMPTY_FEATURES(),
});

function formatLimit(n: number): string {
  if (n === -1) return 'Unlimited';
  return n.toLocaleString();
}

function formatPrice(cents: number | null, currency: string): string {
  if (cents === null) return '—';
  return `${(cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency,
  })}`;
}

export function AdminPlansClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data: plans, isLoading } = adminApi.plan.list.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const invalidate = () => {
    void utils.plan.list.invalidate();
  };

  const create = adminApi.plan.create.useMutation({
    onSuccess: () => {
      toast.success('Plan created.');
      invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const update = adminApi.plan.update.useMutation({
    onSuccess: () => {
      toast.success('Plan saved.');
      invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const setArchived = adminApi.plan.setArchived.useMutation({
    onSuccess: () => {
      toast.success('Updated.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const setDefault = adminApi.plan.setDefault.useMutation({
    onSuccess: () => {
      toast.success('Default updated.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const openNew = () => {
    setForm(EMPTY_FORM());
    setOpen(true);
  };

  const openEdit = (planId: string) => {
    const plan = (plans ?? []).find((p) => p.id === planId);
    if (!plan) return;
    const features = EMPTY_FEATURES();
    for (const f of plan.features) {
      features[f.metric] = {
        included: String(f.included),
        overageCentsPer1k:
          f.overageCentsPer1k === null ? '' : String(f.overageCentsPer1k),
      };
    }
    setForm({
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      description: plan.description ?? '',
      priceMonthlyCents:
        plan.priceMonthlyCents === null ? '' : String(plan.priceMonthlyCents),
      priceYearlyCents:
        plan.priceYearlyCents === null ? '' : String(plan.priceYearlyCents),
      currency: plan.currency,
      features,
    });
    setOpen(true);
  };

  const isSaving = create.isPending || update.isPending;

  const onSave = () => {
    const features = METRICS.map((m) => {
      const v = form.features[m];
      const included = Number.parseInt(v.included, 10);
      const overage = v.overageCentsPer1k.trim()
        ? Number.parseInt(v.overageCentsPer1k, 10)
        : null;
      return {
        metric: m,
        included: Number.isFinite(included) ? included : 0,
        overageCentsPer1k:
          overage !== null && Number.isFinite(overage) ? overage : null,
      };
    });
    const payload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() ? form.description.trim() : null,
      priceMonthlyCents: form.priceMonthlyCents.trim()
        ? Number.parseInt(form.priceMonthlyCents, 10)
        : null,
      priceYearlyCents: form.priceYearlyCents.trim()
        ? Number.parseInt(form.priceYearlyCents, 10)
        : null,
      currency: form.currency.trim().toUpperCase() || 'USD',
      features,
    };
    if (form.id) {
      update.mutate({ id: form.id, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  const planRows = useMemo(() => plans ?? [], [plans]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-2 size-3.5" /> New plan
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : planRows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No plans yet. Create the first one to get started.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {planRows.map((p) => (
            <li key={p.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{p.name}</p>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {p.slug}
                    </code>
                    {p.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        <Star className="size-2.5" /> Default
                      </span>
                    )}
                    {p.isArchived && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Archived
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(p.priceMonthlyCents, p.currency)} / mo ·{' '}
                    {formatPrice(p.priceYearlyCents, p.currency)} / yr ·{' '}
                    {p._count.subscriptions} subscriber
                    {p._count.subscriptions === 1 ? '' : 's'}
                  </p>
                  {p.description && (
                    <p className="text-xs text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    {p.features.map((f) => (
                      <span
                        key={f.id}
                        className="rounded border bg-muted/30 px-1.5 py-0.5"
                      >
                        {METRIC_LABEL[f.metric]}: {formatLimit(f.included)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!p.isDefault && !p.isArchived && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDefault.mutate({ id: p.id })}
                      disabled={setDefault.isPending}
                      title="Set as default plan"
                    >
                      <Star className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(p.id)}
                    title="Edit plan"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setArchived.mutate({
                        id: p.id,
                        isArchived: !p.isArchived,
                      })
                    }
                    disabled={setArchived.isPending}
                    title={p.isArchived ? 'Unarchive' : 'Archive'}
                  >
                    {p.isArchived ? (
                      <ArchiveRestore className="size-3.5" />
                    ) : (
                      <Archive className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit plan' : 'New plan'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Growth"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) =>
                  setForm((f) => ({ ...f, slug: e.target.value }))
                }
                placeholder="growth"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Input
                value={form.currency}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currency: e.target.value }))
                }
                placeholder="USD"
                maxLength={3}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Price / month (cents)</Label>
              <Input
                inputMode="numeric"
                value={form.priceMonthlyCents}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priceMonthlyCents: e.target.value }))
                }
                placeholder="4900"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Price / year (cents)</Label>
              <Input
                inputMode="numeric"
                value={form.priceYearlyCents}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priceYearlyCents: e.target.value }))
                }
                placeholder="49000"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Description</Label>
              <textarea
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Short marketing-facing copy"
              />
            </div>
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[1fr_120px_140px] gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Metric</span>
              <span>Included</span>
              <span>Overage ¢/1k</span>
            </div>
            <div className="divide-y">
              {METRICS.map((m) => {
                const v = form.features[m];
                return (
                  <div
                    key={m}
                    className="grid grid-cols-[1fr_120px_140px] items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground">{METRIC_LABEL[m]}</span>
                    <Input
                      inputMode="numeric"
                      value={v.included}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          features: {
                            ...f.features,
                            [m]: { ...f.features[m], included: e.target.value },
                          },
                        }))
                      }
                    />
                    <Input
                      inputMode="numeric"
                      value={v.overageCentsPer1k}
                      placeholder="—"
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          features: {
                            ...f.features,
                            [m]: {
                              ...f.features[m],
                              overageCentsPer1k: e.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <p className="border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <CheckCircle2 className="mr-1 inline size-3" />
              Use <code>-1</code> for unlimited, <code>0</code> for not
              included.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {form.id ? 'Save changes' : 'Create plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
