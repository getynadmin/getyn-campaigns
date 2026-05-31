'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Save, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { adminApi } from '@/lib/admin-trpc';

type AssetField =
  | 'defaultSidebarLogoLightUrl'
  | 'defaultSidebarLogoDarkUrl'
  | 'loginPageLogoUrl'
  | 'faviconUrl';

interface FormState {
  appName: string;
  defaultSidebarLogoLightUrl: string | null;
  defaultSidebarLogoDarkUrl: string | null;
  loginPageLogoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  loginPageTagline: string;
  footerText: string;
  customCss: string;
}

const EMPTY: FormState = {
  appName: 'Getyn Campaigns',
  defaultSidebarLogoLightUrl: null,
  defaultSidebarLogoDarkUrl: null,
  loginPageLogoUrl: null,
  faviconUrl: null,
  primaryColor: '',
  accentColor: '',
  loginPageTagline: '',
  footerText: '',
  customCss: '',
};

export function SiteSettingsClient(): JSX.Element {
  const utils = adminApi.useUtils();
  const { data, isLoading } = adminApi.siteBranding.get.useQuery();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setForm({
      appName: data.appName,
      defaultSidebarLogoLightUrl: data.defaultSidebarLogoLightUrl,
      defaultSidebarLogoDarkUrl: data.defaultSidebarLogoDarkUrl,
      loginPageLogoUrl: data.loginPageLogoUrl,
      faviconUrl: data.faviconUrl,
      primaryColor: data.primaryColor ?? '',
      accentColor: data.accentColor ?? '',
      loginPageTagline: data.loginPageTagline ?? '',
      footerText: data.footerText ?? '',
      customCss: data.customCss ?? '',
    });
    setHydrated(true);
  }, [data, hydrated]);

  const save = adminApi.siteBranding.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      void utils.siteBranding.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const reset = adminApi.siteBranding.resetField.useMutation({
    onSuccess: () => {
      toast.success('Cleared.');
      void utils.siteBranding.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;

  const onSave = () => {
    save.mutate({
      appName: form.appName.trim(),
      defaultSidebarLogoLightUrl: form.defaultSidebarLogoLightUrl,
      defaultSidebarLogoDarkUrl: form.defaultSidebarLogoDarkUrl,
      loginPageLogoUrl: form.loginPageLogoUrl,
      faviconUrl: form.faviconUrl,
      primaryColor: form.primaryColor || null,
      accentColor: form.accentColor || null,
      loginPageTagline: form.loginPageTagline || null,
      footerText: form.footerText || null,
      customCss: form.customCss || null,
    });
  };

  return (
    <Tabs defaultValue="branding" className="space-y-4">
      <TabsList>
        <TabsTrigger value="branding">Branding</TabsTrigger>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>

      <TabsContent value="branding" className="space-y-4">
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <AssetUploader
            label="Login page logo"
            hint="Shown above the login form. Recommended: 200×60px PNG with transparent background."
            field="loginPageLogoUrl"
            value={form.loginPageLogoUrl}
            onChange={(url) =>
              setForm((f) => ({ ...f, loginPageLogoUrl: url }))
            }
            onReset={() => reset.mutate({ field: 'loginPageLogoUrl' })}
          />
          <AssetUploader
            label="Default sidebar logo (light mode)"
            hint="Used in tenant and admin sidebars on light backgrounds. Recommended: 180×40px."
            field="defaultSidebarLogoLightUrl"
            value={form.defaultSidebarLogoLightUrl}
            onChange={(url) =>
              setForm((f) => ({ ...f, defaultSidebarLogoLightUrl: url }))
            }
            onReset={() =>
              reset.mutate({ field: 'defaultSidebarLogoLightUrl' })
            }
          />
          <AssetUploader
            label="Default sidebar logo (dark mode)"
            hint="Falls back to the light logo when not set."
            field="defaultSidebarLogoDarkUrl"
            value={form.defaultSidebarLogoDarkUrl}
            onChange={(url) =>
              setForm((f) => ({ ...f, defaultSidebarLogoDarkUrl: url }))
            }
            onReset={() =>
              reset.mutate({ field: 'defaultSidebarLogoDarkUrl' })
            }
          />
          <AssetUploader
            label="Favicon"
            hint="32×32 PNG or ICO. Browser tab icon."
            field="faviconUrl"
            value={form.faviconUrl}
            onChange={(url) => setForm((f) => ({ ...f, faviconUrl: url }))}
            onReset={() => reset.mutate({ field: 'faviconUrl' })}
          />
        </section>
        <SaveBar onSave={onSave} pending={save.isPending} />
      </TabsContent>

      <TabsContent value="appearance" className="space-y-4">
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">App name</Label>
              <Input
                value={form.appName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, appName: e.target.value }))
                }
                placeholder="Getyn Campaigns"
              />
              <p className="text-[10px] text-muted-foreground">
                Appears in the browser tab title and system email subjects.
              </p>
            </div>
            <ColorField
              label="Primary color"
              value={form.primaryColor}
              onChange={(v) => setForm((f) => ({ ...f, primaryColor: v }))}
            />
            <ColorField
              label="Accent color"
              value={form.accentColor}
              onChange={(v) => setForm((f) => ({ ...f, accentColor: v }))}
            />
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Login page tagline</Label>
              <Input
                value={form.loginPageTagline}
                onChange={(e) =>
                  setForm((f) => ({ ...f, loginPageTagline: e.target.value }))
                }
                placeholder="Multi-channel campaigns for growing teams"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Footer text</Label>
              <Input
                value={form.footerText}
                onChange={(e) =>
                  setForm((f) => ({ ...f, footerText: e.target.value }))
                }
                placeholder="© 2026 Getyn. All rights reserved."
              />
            </div>
          </div>
        </section>
        <SaveBar onSave={onSave} pending={save.isPending} />
      </TabsContent>

      <TabsContent value="advanced" className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Custom CSS is injected into the root layout&apos;s{' '}
            <code>&lt;style&gt;</code> tag and applies globally. Test
            thoroughly before saving — bad selectors can break the layout.
          </p>
        </div>
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div className="space-y-1">
            <Label className="text-xs">Custom CSS</Label>
            <textarea
              rows={20}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.customCss}
              onChange={(e) =>
                setForm((f) => ({ ...f, customCss: e.target.value }))
              }
              placeholder=":root { --brand-primary: #1c64f2; }"
            />
          </div>
        </section>
        <SaveBar onSave={onSave} pending={save.isPending} />
      </TabsContent>
    </Tabs>
  );
}

function SaveBar({
  onSave,
  pending,
}: {
  onSave: () => void;
  pending: boolean;
}): JSX.Element {
  return (
    <div className="flex justify-end">
      <Button onClick={onSave} disabled={pending}>
        {pending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Save className="mr-2 size-4" />
        )}
        Save changes
      </Button>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 rounded border bg-background"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#1c64f2"
          maxLength={7}
          className="font-mono"
        />
      </div>
    </div>
  );
}

function AssetUploader({
  label,
  hint,
  field,
  value,
  onChange,
  onReset,
}: {
  label: string;
  hint: string;
  field: AssetField;
  value: string | null;
  onChange: (url: string | null) => void;
  onReset: () => void;
}): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const request = adminApi.siteBranding.requestUpload.useMutation();

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const ext =
        (file.name.split('.').pop() ?? 'png').toLowerCase();
      const allowedExts = [
        'png',
        'jpg',
        'jpeg',
        'svg',
        'ico',
        'webp',
      ] as const;
      if (!allowedExts.includes(ext as (typeof allowedExts)[number])) {
        throw new Error('Unsupported file type. Use PNG/JPG/SVG/ICO/WEBP.');
      }
      const upload = await request.mutateAsync({
        field,
        ext: ext as (typeof allowedExts)[number],
      });
      const putRes = await fetch(upload.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': file.type },
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status}).`);
      }
      onChange(upload.publicUrl);
      toast.success('Uploaded. Click Save to apply.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        </div>
        {value && (
          <Button variant="ghost" size="icon" onClick={onReset} title="Clear">
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {value ? (
          <div className="grid h-16 w-32 place-items-center overflow-hidden rounded-md border bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <div className="grid h-16 w-32 place-items-center rounded-md border border-dashed text-[10px] text-muted-foreground">
            No image
          </div>
        )}
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/x-icon,image/webp,.ico"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <span className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent/40">
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload
          </span>
        </label>
      </div>
    </div>
  );
}
