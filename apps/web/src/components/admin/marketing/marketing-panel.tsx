'use client';

import { Check, Loader2, Play, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { adminApi } from '@/lib/admin-trpc';

type Kind = 'retargeting' | 'cart';

interface Reminder {
  id: string;
  name: string;
  delayMinutes: number;
  subject: string;
  bodyHtml: string;
  bcc: string | null;
  enabled: boolean;
  sortOrder: number;
}

function formatDelay(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = mins / 60;
  if (h < 24) return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  const d = h / 24;
  return `${d % 1 === 0 ? d : d.toFixed(1)} d`;
}

export function MarketingPanel({ kind }: { kind: Kind }): JSX.Element {
  const utils = adminApi.useUtils();
  const { data: overview, isLoading } = adminApi.marketing.overview.useQuery();

  const remindersQ =
    kind === 'retargeting'
      ? adminApi.marketing.listRetargetReminders.useQuery()
      : adminApi.marketing.listCartReminders.useQuery();

  const openCartsQ =
    kind === 'cart'
      ? adminApi.marketing.listOpenCarts.useQuery()
      : ({ data: undefined } as { data: undefined });

  const saveConfig = adminApi.marketing.saveConfig.useMutation({
    onSuccess: () => {
      toast.success('Settings saved');
      utils.marketing.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const runNow = (
    kind === 'retargeting'
      ? adminApi.marketing.runRetargetingNow
      : adminApi.marketing.runCartRecoveryNow
  ).useMutation({
    onSuccess: (r) => {
      toast.success(`Sent ${r.sent}, skipped ${r.skipped}, errors ${r.errors}`);
      utils.marketing.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const saveReminder = (
    kind === 'retargeting'
      ? adminApi.marketing.saveRetargetReminder
      : adminApi.marketing.saveCartReminder
  ).useMutation({
    onSuccess: () => {
      toast.success('Reminder saved');
      remindersQ.refetch();
      utils.marketing.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = (
    kind === 'retargeting'
      ? adminApi.marketing.toggleRetargetReminder
      : adminApi.marketing.toggleCartReminder
  ).useMutation({ onSuccess: () => remindersQ.refetch() });

  const del = (
    kind === 'retargeting'
      ? adminApi.marketing.deleteRetargetReminder
      : adminApi.marketing.deleteCartReminder
  ).useMutation({
    onSuccess: () => {
      toast.success('Reminder deleted');
      remindersQ.refetch();
    },
  });

  const [editing, setEditing] = useState<Reminder | null>(null);
  const [showNew, setShowNew] = useState(false);

  if (isLoading || !overview) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const stats = kind === 'retargeting' ? overview.retarget : overview.cart;
  const enabled =
    kind === 'retargeting'
      ? overview.config.retargetEnabled
      : overview.config.cartEnabled;

  const cronOk = overview.cronSecretConfigured;
  const resendOk = overview.resendConfigured;
  const remindersOk = stats.reminderCount > 0;

  return (
    <div className="space-y-6">
      {/* Go-live checklist */}
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Go-live checklist
        </h2>
        <ul className="space-y-2 text-sm">
          <Check3
            ok={resendOk}
            text="Resend configured in Integrations → Sending Servers"
          />
          <Check3
            ok={cronOk}
            text="CRON_SECRET env var set on Vercel (cron can authenticate)"
          />
          <Check3 ok={remindersOk} text="At least one reminder in the sequence" />
          <Check3
            ok={enabled}
            text="Master switch ON (flip below when ready)"
          />
        </ul>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sends (30d)" value={stats.sends30d} />
        {kind === 'retargeting' ? (
          <Stat label="Dormant users" value={overview.retarget.dormantUsers} />
        ) : (
          <>
            <Stat label="Open carts" value={overview.cart.openCarts} />
            <Stat
              label="Recovered revenue (30d)"
              value={`$${(overview.cart.recoveredRevenueCents / 100).toFixed(0)}`}
            />
          </>
        )}
        <Stat label="Reminders" value={stats.reminderCount} />
      </section>

      {/* Settings */}
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Settings</h2>
        <div className="flex items-center justify-between gap-4 border-b pb-4">
          <div>
            <p className="font-medium">
              {kind === 'retargeting'
                ? 'Enable retargeting emails'
                : 'Enable cart recovery emails'}
            </p>
            <p className="text-xs text-muted-foreground">
              {kind === 'retargeting'
                ? 'Chase dormant signed-in users with stage-based reminders.'
                : 'Chase abandoned checkouts with resume-cart emails.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              saveConfig.mutate(
                kind === 'retargeting'
                  ? { retargetEnabled: !enabled }
                  : { cartEnabled: !enabled },
              )
            }
            className={`inline-flex h-6 w-11 items-center rounded-full transition ${
              enabled ? 'bg-emerald-500' : 'bg-zinc-300'
            }`}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow transition ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending || !enabled}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {runNow.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Run now
          </button>
        </div>
      </section>

      {/* Reminder sequence */}
      <section className="rounded-lg border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Reminder sequence</h2>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-4" />
            Add reminder
          </button>
        </div>
        <div className="space-y-2">
          {remindersQ.data?.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border bg-background p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {r.name}{' '}
                  <span className="ml-1 text-xs text-muted-foreground">
                    · {formatDelay(r.delayMinutes)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{r.subject}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    toggle.mutate({ id: r.id, enabled: !r.enabled })
                  }
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    r.enabled
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  {r.enabled ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="rounded px-2 py-1 text-xs hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete "${r.name}"?`)) del.mutate({ id: r.id });
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
          {remindersQ.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reminders yet. Add one to get started.
            </p>
          ) : null}
        </div>
      </section>

      {/* Open carts (cart recovery only) */}
      {kind === 'cart' && openCartsQ.data ? (
        <section className="rounded-lg border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Open carts (latest 50)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Plan</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Abandoned</th>
                </tr>
              </thead>
              <tbody>
                {openCartsQ.data.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      {c.customerFirstName
                        ? `${c.customerFirstName} · ${c.customerEmail}`
                        : c.customerEmail}
                    </td>
                    <td className="py-2 pr-4">
                      {c.planName} · {c.volumeMessages}
                    </td>
                    <td className="py-2 pr-4">
                      ${(c.amountCents / 100).toFixed(0)} {c.currency}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {openCartsQ.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-muted-foreground">
                      No open carts.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Recent sends */}
      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">Recent sends</h2>
        {stats.recentSends.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sends yet.</p>
        ) : (
          <div className="space-y-1.5">
            {stats.recentSends.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded border bg-background px-3 py-1.5 text-sm"
              >
                <div>
                  <span className="font-medium">{s.recipient}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.reminderName}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${
                      s.status === 'sent'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {s.status}
                  </span>
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Editor modal */}
      {editing || showNew ? (
        <ReminderEditor
          kind={kind}
          initial={editing}
          onClose={() => {
            setEditing(null);
            setShowNew(false);
          }}
          onSave={(r) => {
            saveReminder.mutate(r, {
              onSuccess: () => {
                setEditing(null);
                setShowNew(false);
              },
            });
          }}
          saving={saveReminder.isPending}
        />
      ) : null}
    </div>
  );
}

function Check3({ ok, text }: { ok: boolean; text: string }): JSX.Element {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="size-4 text-emerald-600" />
      ) : (
        <X className="size-4 text-amber-500" />
      )}
      <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>
        {text}
      </span>
    </li>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ReminderEditor({
  kind,
  initial,
  onClose,
  onSave,
  saving,
}: {
  kind: Kind;
  initial: Reminder | null;
  onClose: () => void;
  onSave: (r: {
    id?: string;
    name: string;
    delayMinutes: number;
    subject: string;
    bodyHtml: string;
    bcc: string | null;
    enabled: boolean;
    sortOrder: number;
  }) => void;
  saving: boolean;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [delayMinutes, setDelayMinutes] = useState(initial?.delayMinutes ?? 60);
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(initial?.bodyHtml ?? '');
  const [bcc, setBcc] = useState(initial?.bcc ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);

  const vars =
    kind === 'retargeting'
      ? ['user_name', 'continue_url', 'site_name', 'whatsapp_url']
      : [
          'user_name',
          'plan_name',
          'credits',
          'amount',
          'checkout_url',
          'whatsapp_url',
          'site_name',
        ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">
            {initial ? 'Edit reminder' : 'New reminder'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Name</span>
              <input
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Delay (minutes)</span>
              <input
                type="number"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5"
                value={delayMinutes}
                onChange={(e) =>
                  setDelayMinutes(Number.parseInt(e.target.value, 10) || 0)
                }
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium">Subject</span>
            <input
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">
              Body HTML — variables:{' '}
              {vars.map((v) => (
                <code
                  key={v}
                  className="ml-1 rounded bg-muted px-1 text-[10px]"
                >{`{{${v}}}`}</code>
              ))}
            </span>
            <textarea
              className="mt-1 h-48 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-2 block">
              <span className="text-xs font-medium">BCC (optional)</span>
              <input
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Sort</span>
              <input
                type="number"
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5"
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(Number.parseInt(e.target.value, 10) || 0)
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              onSave({
                id: initial?.id,
                name,
                delayMinutes,
                subject,
                bodyHtml,
                bcc: bcc.trim() || null,
                enabled,
                sortOrder,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
