'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adminApi } from '@/lib/admin-trpc';

/**
 * Manual tenant creation modal for staff. Triggers
 * admin.tenant.create — see admin-tenants.ts for the server flow.
 *
 * On success: shows the generated password (in case the welcome email
 * didn't fire) with a copy button, then closes after the staff member
 * acknowledges.
 */
export function CreateTenantDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [planId, setPlanId] = useState<string>('');
  const [emailsOverride, setEmailsOverride] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [autoGen, setAutoGen] = useState(true);
  const [customPassword, setCustomPassword] = useState('');
  const [sendWelcome, setSendWelcome] = useState(true);

  const [result, setResult] = useState<{
    password: string;
    tenantId: string;
    slug: string;
    emailOk: boolean | null;
    emailError: string | null;
  } | null>(null);

  const utils = adminApi.useUtils();
  const plans = adminApi.tenant.listPlanOptions.useQuery(undefined, {
    enabled: open,
  });

  // Pre-select the default plan once options load.
  if (open && !planId && plans.data && plans.data.length > 0) {
    const defaultPlan = plans.data.find((p) => p.isDefault) ?? plans.data[0];
    if (defaultPlan) setPlanId(defaultPlan.id);
  }

  const create = adminApi.tenant.create.useMutation({
    onSuccess: (data) => {
      setResult({
        password: data.password,
        tenantId: data.tenantId,
        slug: data.slug,
        emailOk: data.email?.ok ?? null,
        emailError: data.email?.error ?? null,
      });
      void utils.tenant.list.invalidate();
      toast.success(`Tenant "${name}" created.`);
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm(): void {
    setName('');
    setOwnerEmail('');
    setOwnerName('');
    setPlanId('');
    setEmailsOverride('');
    setExpiresAt('');
    setAutoGen(true);
    setCustomPassword('');
    setSendWelcome(true);
    setResult(null);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!planId) {
      toast.error('Pick a plan.');
      return;
    }
    const emailsTrim = emailsOverride.trim();
    let emailsParsed: number | null = null;
    if (emailsTrim !== '') {
      const n = Number(emailsTrim);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < -1) {
        toast.error('Email quota must be a whole number (-1 = unlimited).');
        return;
      }
      emailsParsed = n;
    }
    let expiresIso: string | null = null;
    if (expiresAt.trim() !== '') {
      // <input type="date"> yields YYYY-MM-DD — interpret as end of
      // day UTC so the customer keeps service through their final day.
      const d = new Date(`${expiresAt}T23:59:59.000Z`);
      if (Number.isNaN(d.getTime())) {
        toast.error('Invalid expiry date.');
        return;
      }
      expiresIso = d.toISOString();
    }
    create.mutate({
      name: name.trim(),
      ownerEmail: ownerEmail.trim().toLowerCase(),
      ownerName: ownerName.trim() || undefined,
      planId,
      emailsPerMonthOverride: emailsParsed,
      expiresAt: expiresIso,
      autoGeneratePassword: autoGen,
      customPassword: autoGen ? undefined : customPassword,
      sendWelcomeEmail: sendWelcome,
    });
  }

  function handleClose(): void {
    setOpen(false);
    setTimeout(resetForm, 200); // wait for close animation
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
        else setOpen(true);
      }}
    >
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="mr-1 size-4" /> Add tenant
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? 'Tenant created' : 'Create tenant'}</DialogTitle>
          <DialogDescription>
            {result
              ? `Workspace /${result.slug} is ready.`
              : 'Manually create a workspace and (optionally) email the owner their sign-in details.'}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <ResultPane
            password={result.password}
            slug={result.slug}
            emailOk={result.emailOk}
            emailError={result.emailError}
            onDone={handleClose}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Workspace name" required>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Inc."
                  required
                  maxLength={120}
                />
              </Field>
              <Field label="Plan" required>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(plans.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.isDefault ? ' (default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Owner email" required>
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@acme.com"
                  required
                />
              </Field>
              <Field label="Owner name">
                <Input
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Jane Doe"
                  maxLength={120}
                />
              </Field>
              <Field label="Email quota override" hint="-1 = unlimited; blank = use plan default">
                <Input
                  type="number"
                  value={emailsOverride}
                  onChange={(e) => setEmailsOverride(e.target.value)}
                  placeholder="50000"
                  min={-1}
                />
              </Field>
              <Field label="Expires on" hint="Blank = no expiry">
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </Field>
            </div>

            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border"
                  checked={autoGen}
                  onChange={(e) => setAutoGen(e.target.checked)}
                />
                <span>Auto-generate a strong password</span>
              </label>
              {!autoGen && (
                <Field label="Custom password" hint="Minimum 12 characters">
                  <Input
                    type="text"
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    minLength={12}
                    maxLength={128}
                    required={!autoGen}
                  />
                </Field>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border"
                  checked={sendWelcome}
                  onChange={(e) => setSendWelcome(e.target.checked)}
                />
                <span>Email the owner their login credentials (via SMTP)</span>
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                )}
                Create tenant
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ResultPane({
  password,
  slug,
  emailOk,
  emailError,
  onDone,
}: {
  password: string;
  slug: string;
  emailOk: boolean | null;
  emailError: string | null;
  onDone: () => void;
}): JSX.Element {
  function copy(value: string, label: string): void {
    void navigator.clipboard.writeText(value).then(() => {
      toast.success(`${label} copied.`);
    });
  }
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Temporary password
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <code className="rounded bg-background px-2 py-1 font-mono text-sm">
            {password}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => copy(password, 'Password')}
          >
            <Copy className="mr-1 size-3.5" /> Copy
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Save this now — it won&apos;t be shown again. The owner can change
          it after first sign-in.
        </p>
      </div>

      {emailOk === true && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Welcome email sent.
        </p>
      )}
      {emailOk === false && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Welcome email failed: {emailError ?? 'unknown error'}. The tenant
          was still created — share the password manually.
        </p>
      )}

      <DialogFooter>
        <Button asChild variant="outline">
          <a href={`/admin/tenants?slug=${encodeURIComponent(slug)}`}>
            Back to tenants
          </a>
        </Button>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}
