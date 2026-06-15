'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  VOICE_TONE_DESCRIPTIONS,
  type VoiceTone,
  type SocialLink,
} from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

/**
 * Phase 7 M1 — Brand profile form.
 *
 * Five sections per the spec (Identity / Visual / Voice / Signature /
 * Footer). Two save paths:
 *   - Save draft → upsert without touching completedAt
 *   - Save & complete → upsert then mark complete (server-side
 *     validates required fields are filled)
 */

type FormState = {
  brandName: string;
  brandTagline: string;
  brandDescription: string;
  industry: string;
  targetAudience: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  voiceTone: VoiceTone;
  writingStyle: string;
  dosAndDonts: string;
  signatureBlock: string;
  socialLinks: SocialLink[];
  unsubscribeFooterCustom: string;
};

const EMPTY: FormState = {
  brandName: '',
  brandTagline: '',
  brandDescription: '',
  industry: '',
  targetAudience: '',
  primaryColor: '#7c3aed',
  secondaryColor: '',
  accentColor: '',
  logoUrl: '',
  voiceTone: 'FRIENDLY',
  writingStyle: '',
  dosAndDonts: '',
  signatureBlock: '',
  socialLinks: [],
  unsubscribeFooterCustom: '',
};

export function BrandSettingsClient(): JSX.Element {
  const utils = api.useUtils();
  const { data, isLoading } = api.tenantBrand.get.useQuery();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    if (!data) {
      // No profile yet — leave defaults.
      setHydrated(true);
      return;
    }
    setForm({
      brandName: data.brandName ?? '',
      brandTagline: data.brandTagline ?? '',
      brandDescription: data.brandDescription ?? '',
      industry: data.industry ?? '',
      targetAudience: data.targetAudience ?? '',
      primaryColor: data.primaryColor ?? '#7c3aed',
      secondaryColor: data.secondaryColor ?? '',
      accentColor: data.accentColor ?? '',
      logoUrl: data.logoUrl ?? '',
      voiceTone: (data.voiceTone as VoiceTone) ?? 'FRIENDLY',
      writingStyle: data.writingStyle ?? '',
      dosAndDonts: data.dosAndDonts ?? '',
      signatureBlock: data.signatureBlock ?? '',
      socialLinks: (data.socialLinks as SocialLink[] | null) ?? [],
      unsubscribeFooterCustom: data.unsubscribeFooterCustom ?? '',
    });
    setHydrated(true);
  }, [data, hydrated]);

  const upsert = api.tenantBrand.upsert.useMutation({
    onSuccess: () => {
      toast.success('Brand profile saved.');
      void utils.tenantBrand.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const complete = api.tenantBrand.complete.useMutation({
    onSuccess: () => {
      toast.success('Profile marked complete — the agent can use it now.');
      void utils.tenantBrand.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-screen" />;

  const buildPayload = () => ({
    brandName: form.brandName.trim(),
    brandTagline: form.brandTagline.trim() || null,
    brandDescription: form.brandDescription.trim(),
    industry: form.industry.trim() || null,
    targetAudience: form.targetAudience.trim() || null,
    primaryColor: form.primaryColor.trim(),
    secondaryColor: form.secondaryColor.trim() || null,
    accentColor: form.accentColor.trim() || null,
    logoUrl: form.logoUrl.trim() || null,
    voiceTone: form.voiceTone,
    writingStyle: form.writingStyle.trim() || null,
    dosAndDonts: form.dosAndDonts.trim() || null,
    signatureBlock: form.signatureBlock.trim() || null,
    socialLinks: form.socialLinks.filter(
      (l) => l.platform.trim() && l.url.trim(),
    ),
    unsubscribeFooterCustom: form.unsubscribeFooterCustom.trim() || null,
  });

  const handleSaveDraft = () => upsert.mutate(buildPayload());

  const handleSaveComplete = async () => {
    try {
      await upsert.mutateAsync(buildPayload());
      await complete.mutateAsync();
    } catch {
      // Toasts already raised by individual mutations.
    }
  };

  const isComplete = data?.completedAt != null;

  return (
    <div className="space-y-5">
      {/* Status pill */}
      <div
        className={
          isComplete
            ? 'flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-4 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30'
            : 'flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30'
        }
      >
        {isComplete ? (
          <>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            <span>
              Profile complete — the AI Campaign Agent can use this. Last
              updated {new Date(data!.updatedAt).toLocaleDateString()}.
            </span>
          </>
        ) : (
          <>
            <span className="inline-block size-2 rounded-full bg-amber-500" />
            <span>
              Setup incomplete. Fill brand name, description, and primary color
              at minimum, then save &amp; complete.
            </span>
          </>
        )}
      </div>

      {/* Identity */}
      <Section
        title="Identity"
        description="The basics about your brand."
      >
        <Field label="Brand name" required>
          <Input
            value={form.brandName}
            onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))}
            placeholder="Acme Inc"
          />
        </Field>
        <Field label="Tagline">
          <Input
            value={form.brandTagline}
            onChange={(e) =>
              setForm((f) => ({ ...f, brandTagline: e.target.value }))
            }
            placeholder="A short, memorable phrase (optional)"
          />
        </Field>
        <Field
          label="Description"
          required
          hint="In 1–2 sentences, what does your business do?"
        >
          <Textarea
            rows={3}
            value={form.brandDescription}
            onChange={(e) =>
              setForm((f) => ({ ...f, brandDescription: e.target.value }))
            }
            placeholder="We help X do Y by Z."
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Industry">
            <Input
              value={form.industry}
              onChange={(e) =>
                setForm((f) => ({ ...f, industry: e.target.value }))
              }
              placeholder="SaaS, retail, professional services, …"
            />
          </Field>
          <Field label="Target audience">
            <Input
              value={form.targetAudience}
              onChange={(e) =>
                setForm((f) => ({ ...f, targetAudience: e.target.value }))
              }
              placeholder="Heads of marketing at series-A startups"
            />
          </Field>
        </div>
      </Section>

      {/* Visual */}
      <Section
        title="Visual"
        description="The colors and logo the agent uses when designing campaigns."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <ColorField
            label="Primary"
            required
            value={form.primaryColor}
            onChange={(v) => setForm((f) => ({ ...f, primaryColor: v }))}
          />
          <ColorField
            label="Secondary"
            value={form.secondaryColor}
            onChange={(v) => setForm((f) => ({ ...f, secondaryColor: v }))}
          />
          <ColorField
            label="Accent"
            value={form.accentColor}
            onChange={(v) => setForm((f) => ({ ...f, accentColor: v }))}
          />
        </div>
        <Field label="Logo URL" hint="Paste a hosted URL for now. Upload to Media (Phase 7 M2) will land soon.">
          <Input
            value={form.logoUrl}
            onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
            placeholder="https://your-domain.com/logo.png"
          />
        </Field>
      </Section>

      {/* Voice */}
      <Section
        title="Voice"
        description="How the agent should sound when it writes copy for you."
      >
        <Field label="Tone">
          <Select
            value={form.voiceTone}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, voiceTone: v as VoiceTone }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(VOICE_TONE_DESCRIPTIONS) as VoiceTone[]).map((t) => (
                <SelectItem key={t} value={t}>
                  <span className="font-medium">{t}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    — {VOICE_TONE_DESCRIPTIONS[t]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Writing style" hint="Phrases or quirks the agent should mirror.">
          <Textarea
            rows={2}
            value={form.writingStyle}
            onChange={(e) =>
              setForm((f) => ({ ...f, writingStyle: e.target.value }))
            }
            placeholder="Short sentences. Plain language. Avoid em-dashes."
          />
        </Field>
        <Field label="Dos and don'ts">
          <Textarea
            rows={3}
            value={form.dosAndDonts}
            onChange={(e) =>
              setForm((f) => ({ ...f, dosAndDonts: e.target.value }))
            }
            placeholder="Always say 'team' not 'staff'. Never use 'guys'."
          />
        </Field>
      </Section>

      {/* Signature */}
      <Section
        title="Signature"
        description="What goes at the end of every email."
      >
        <Field label="Email signature block">
          <Textarea
            rows={4}
            value={form.signatureBlock}
            onChange={(e) =>
              setForm((f) => ({ ...f, signatureBlock: e.target.value }))
            }
            placeholder={'— The Acme team\n[Reply directly to this email]'}
          />
        </Field>
        <Field label="Social links">
          <div className="space-y-2">
            {form.socialLinks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No social links yet.
              </p>
            )}
            {form.socialLinks.map((link, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  placeholder="Platform (Twitter, LinkedIn, …)"
                  value={link.platform}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      socialLinks: f.socialLinks.map((l, i) =>
                        i === idx ? { ...l, platform: e.target.value } : l,
                      ),
                    }))
                  }
                  className="max-w-[12rem]"
                />
                <Input
                  type="url"
                  placeholder="https://…"
                  value={link.url}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      socialLinks: f.socialLinks.map((l, i) =>
                        i === idx ? { ...l, url: e.target.value } : l,
                      ),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      socialLinks: f.socialLinks.filter((_, i) => i !== idx),
                    }))
                  }
                  title="Remove"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  socialLinks: [...f.socialLinks, { platform: '', url: '' }],
                }))
              }
              disabled={form.socialLinks.length >= 20}
            >
              <Plus className="mr-2 size-3.5" />
              Add link
            </Button>
          </div>
        </Field>
      </Section>

      {/* Footer */}
      <Section
        title="Footer"
        description="Custom footer text appears above the mandatory unsubscribe link the composer auto-injects."
      >
        <Field label="Custom footer text">
          <Textarea
            rows={3}
            value={form.unsubscribeFooterCustom}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                unsubscribeFooterCustom: e.target.value,
              }))
            }
            placeholder={'You received this because you signed up at acme.com.'}
          />
        </Field>
      </Section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          disabled={upsert.isPending}
        >
          {upsert.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : null}
          Save draft
        </Button>
        <Button
          onClick={handleSaveComplete}
          disabled={upsert.isPending || complete.isPending}
        >
          {(upsert.isPending || complete.isPending) ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Check className="mr-2 size-4" />
          )}
          Save &amp; complete
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
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
      <Label className="flex items-center gap-1 text-xs">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </Label>
      {children}
      {hint && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}): JSX.Element {
  return (
    <Field label={label} required={required}>
      <div className="flex gap-2">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-10 cursor-pointer rounded border bg-background"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#7c3aed"
          maxLength={9}
          className="font-mono"
        />
      </div>
    </Field>
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return (
    <textarea
      {...props}
      className={
        'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
        (props.className ?? '')
      }
    />
  );
}
