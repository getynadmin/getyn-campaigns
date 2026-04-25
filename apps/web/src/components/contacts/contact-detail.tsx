'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { ArrowLeft, MoreHorizontal, Trash2 } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';

import { Role } from '@getyn/db';
import {
  contactCreateSchema,
  type ContactCreateInput,
  type SubscriptionStatusValue,
} from '@getyn/types';
import type { AppRouter } from '@/server/trpc/root';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ContactGet = RouterOutputs['contacts']['get'];
type CustomFieldRow = RouterOutputs['customFields']['list'][number];

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

import { ActivityTimeline } from './activity-timeline';
import { StatusBadge } from './status-badge';
import { TagChip } from './tag-chip';

type Props = {
  tenantSlug: string;
  contactId: string;
  currentRole: Role;
};

/**
 * Contact detail page — identity editor on the left, tags + custom fields
 * in a right column, activity timeline below. Everything is wired through
 * a single tRPC `contacts.get` query; mutations invalidate that query key.
 */
export function ContactDetail({
  tenantSlug,
  contactId,
  currentRole,
}: Props): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();
  const { data, isLoading } = api.contacts.get.useQuery({ id: contactId });
  const tagList = api.tags.list.useQuery();
  const customFields = api.customFields.list.useQuery();

  const canEdit =
    currentRole === Role.OWNER ||
    currentRole === Role.ADMIN ||
    currentRole === Role.EDITOR;
  const canDelete =
    currentRole === Role.OWNER ||
    currentRole === Role.ADMIN ||
    currentRole === Role.EDITOR;

  const softDelete = api.contacts.softDelete.useMutation({
    onSuccess: () => {
      toast.success('Contact deleted.');
      router.push(`/t/${tenantSlug}/contacts`);
    },
    onError: (err) => toast.error(err.message),
  });
  const restore = api.contacts.restore.useMutation({
    onSuccess: () => {
      toast.success('Contact restored.');
      void utils.contacts.get.invalidate({ id: contactId });
    },
    onError: (err) => toast.error(err.message),
  });
  const assign = api.tags.assign.useMutation({
    onSuccess: () => void utils.contacts.get.invalidate({ id: contactId }),
    onError: (err) => toast.error(err.message),
  });
  const unassign = api.tags.unassign.useMutation({
    onSuccess: () => void utils.contacts.get.invalidate({ id: contactId }),
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12 text-center text-sm text-muted-foreground">
        Contact not found.
      </div>
    );
  }

  const display =
    [data.firstName, data.lastName].filter(Boolean).join(' ') ||
    data.email ||
    data.phone ||
    'Unnamed contact';

  const assignedTagIds = new Set(data.tags.map((t) => t.id));
  const availableTags = (tagList.data ?? []).filter((t) => !assignedTagIds.has(t.id));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={`/t/${tenantSlug}/contacts`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All contacts
          </Link>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {display}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {data.email ? <span>{data.email}</span> : null}
            {data.phone ? <span>{data.phone}</span> : null}
            {data.deletedAt ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-900 dark:bg-rose-950 dark:text-rose-200">
                Deleted
              </span>
            ) : null}
          </div>
        </div>

        {canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-9">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {data.deletedAt ? (
                currentRole === Role.OWNER || currentRole === Role.ADMIN ? (
                  <DropdownMenuItem
                    onSelect={() => restore.mutate({ id: data.id })}
                    disabled={restore.isPending}
                  >
                    Restore contact
                  </DropdownMenuItem>
                ) : null
              ) : (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => softDelete.mutate({ id: data.id })}
                  disabled={softDelete.isPending}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete contact
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <IdentityCard
            contact={data}
            canEdit={canEdit && !data.deletedAt}
            onSaved={() => void utils.contacts.get.invalidate({ id: contactId })}
          />
          <CustomFieldsCard
            contactId={data.id}
            current={(data.customFields ?? {}) as Record<string, unknown>}
            canEdit={canEdit && !data.deletedAt}
            fields={customFields.data ?? []}
          />
          <ActivityTimeline contactId={data.id} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {data.tags.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No tags</span>
                ) : (
                  data.tags.map((t) => (
                    <TagChip
                      key={t.id}
                      tag={t}
                      size="sm"
                      onRemove={
                        canEdit
                          ? () =>
                              unassign.mutate({
                                contactId: data.id,
                                tagId: t.id,
                              })
                          : undefined
                      }
                    />
                  ))
                )}
              </div>
              {canEdit && availableTags.length > 0 ? (
                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Add</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableTags.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          assign.mutate({ contactId: data.id, tagId: t.id })
                        }
                        className="opacity-60 transition-opacity hover:opacity-100"
                      >
                        <TagChip tag={t} size="sm" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <StatusRow label="Email" status={data.emailStatus} />
              <StatusRow label="SMS" status={data.smsStatus} />
              <StatusRow label="WhatsApp" status={data.whatsappStatus} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  status,
}: {
  label: string;
  status: SubscriptionStatusValue;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <StatusBadge status={status} />
    </div>
  );
}

function IdentityCard({
  contact,
  canEdit,
  onSaved,
}: {
  contact: ContactGet;
  canEdit: boolean;
  onSaved: () => void;
}): JSX.Element {
  const form = useForm<ContactCreateInput>({
    resolver: zodResolver(contactCreateSchema),
    defaultValues: {
      email: contact.email ?? undefined,
      phone: contact.phone ?? undefined,
      firstName: contact.firstName ?? undefined,
      lastName: contact.lastName ?? undefined,
      emailStatus: contact.emailStatus,
      smsStatus: contact.smsStatus,
      whatsappStatus: contact.whatsappStatus,
    },
  });

  useEffect(() => {
    form.reset({
      email: contact.email ?? undefined,
      phone: contact.phone ?? undefined,
      firstName: contact.firstName ?? undefined,
      lastName: contact.lastName ?? undefined,
      emailStatus: contact.emailStatus,
      smsStatus: contact.smsStatus,
      whatsappStatus: contact.whatsappStatus,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);

  const update = api.contacts.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      onSaved();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Identity</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) =>
              update.mutate({
                id: contact.id,
                patch: {
                  email: v.email,
                  phone: v.phone,
                  firstName: v.firstName,
                  lastName: v.lastName,
                  emailStatus: v.emailStatus,
                  smsStatus: v.smsStatus,
                  whatsappStatus: v.whatsappStatus,
                },
              }),
            )}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input
                        disabled={!canEdit}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input
                        disabled={!canEdit}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        disabled={!canEdit}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        disabled={!canEdit}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatusSelect control={form.control} name="emailStatus" label="Email" disabled={!canEdit} />
              <StatusSelect control={form.control} name="smsStatus" label="SMS" disabled={!canEdit} />
              <StatusSelect control={form.control} name="whatsappStatus" label="WhatsApp" disabled={!canEdit} />
            </div>
            {canEdit ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
                  {update.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function StatusSelect({
  control,
  name,
  label,
  disabled,
}: {
  control: ReturnType<typeof useForm<ContactCreateInput>>['control'];
  name: 'emailStatus' | 'smsStatus' | 'whatsappStatus';
  label: string;
  disabled: boolean;
}): JSX.Element {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label} status</FormLabel>
          <Select onValueChange={field.onChange} value={field.value} disabled={disabled}>
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="SUBSCRIBED">Subscribed</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="UNSUBSCRIBED">Unsubscribed</SelectItem>
              <SelectItem value="BOUNCED">Bounced</SelectItem>
              <SelectItem value="COMPLAINED">Complained</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CustomFieldsCard({
  contactId,
  current,
  canEdit,
  fields,
}: {
  contactId: string;
  current: Record<string, unknown>;
  canEdit: boolean;
  fields: CustomFieldRow[];
}): JSX.Element {
  const utils = api.useUtils();
  const update = api.contacts.update.useMutation({
    onSuccess: () => {
      toast.success('Saved.');
      void utils.contacts.get.invalidate({ id: contactId });
    },
    onError: (err) => toast.error(err.message),
  });

  const [values, setValues] = useState<Record<string, unknown>>(current);
  // Mirror current into state when the contact changes (or refetches).
  useEffect(() => {
    setValues(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(current), contactId]);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(current),
    [values, current],
  );

  const setValue = (key: string, raw: unknown): void => {
    setValues((prev) => ({ ...prev, [key]: raw }));
  };

  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Custom fields</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No custom fields defined yet. Add them under Settings → Custom fields.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Custom fields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((f) => {
          const v = values[f.key];
          const options = (f.options as { choices?: string[] } | null)?.choices ?? [];
          return (
            <div key={f.id} className="grid grid-cols-[160px_1fr] items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
              {f.type === 'SELECT' ? (
                <Select
                  value={(v as string) ?? ''}
                  onValueChange={(val) => setValue(f.key, val)}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === 'BOOLEAN' ? (
                <Select
                  value={v === true ? 'true' : v === false ? 'false' : ''}
                  onValueChange={(val) => setValue(f.key, val === 'true')}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'}
                  value={(v as string | number) ?? ''}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (f.type === 'NUMBER') {
                      setValue(f.key, raw === '' ? null : Number(raw));
                    } else {
                      setValue(f.key, raw === '' ? null : raw);
                    }
                  }}
                />
              )}
            </div>
          );
        })}
        {canEdit ? (
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() =>
                update.mutate({
                  id: contactId,
                  patch: { customFields: values as Record<string, string | number | boolean | null> },
                })
              }
              disabled={!dirty || update.isPending}
            >
              {update.isPending ? 'Saving…' : 'Save custom fields'}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

