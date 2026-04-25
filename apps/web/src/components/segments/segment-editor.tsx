'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Save, Users } from 'lucide-react';

import type { SegmentRules } from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';

import { buildFieldCatalog } from './field-catalog';
import { RuleBuilder } from './rule-builder';
import { SegmentPreview } from './segment-preview';

/**
 * Shared editor for creating a new segment or updating an existing one.
 *
 * For a brand-new segment the parent passes `mode: 'create'` + an empty
 * initial rule tree. For an edit, `mode: 'update'` + the server-fetched
 * rules. Everything in between is identical — the submit handler routes to
 * `create` or `update` based on mode.
 *
 * We hold the rules in local state rather than a form library because the
 * rule tree is deeply nested and the single controlled prop path is easier
 * to reason about than integrating react-hook-form's field arrays here.
 * `name` + `description` are simple strings, also held locally.
 */

type Mode =
  | { kind: 'create' }
  | { kind: 'update'; segmentId: string };

export type SegmentEditorProps = {
  tenantSlug: string;
  mode: Mode;
  initialName?: string;
  initialDescription?: string;
  initialRules: SegmentRules;
};

const EMPTY_RULES: SegmentRules = {
  kind: 'group',
  operator: 'AND',
  children: [
    { kind: 'condition', field: 'email_status', operator: 'equals', value: 'SUBSCRIBED' },
  ],
};

export function emptyRules(): SegmentRules {
  // Deep-clone so callers can mutate without sharing references.
  return JSON.parse(JSON.stringify(EMPTY_RULES));
}

export function SegmentEditor({
  tenantSlug,
  mode,
  initialName = '',
  initialDescription = '',
  initialRules,
}: SegmentEditorProps): JSX.Element {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [rules, setRules] = useState<SegmentRules>(initialRules);

  const customFields = api.customFields.list.useQuery();
  const tags = api.tags.list.useQuery();

  const catalog = useMemo(
    () =>
      buildFieldCatalog({
        customFields: (customFields.data ?? []).map((f) => ({
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type,
          // Prisma serialises `options` as `Json | null` — coerce to the
          // narrow shape the catalog expects.
          options: (f.options as { choices?: string[] } | null) ?? null,
        })),
      }),
    [customFields.data],
  );

  const tagOptions = useMemo(
    () => (tags.data ?? []).map((t) => ({ id: t.id, name: t.name })),
    [tags.data],
  );

  const utils = api.useUtils();
  const createMutation = api.segments.create.useMutation({
    onSuccess: (seg) => {
      toast.success('Segment saved.');
      utils.segments.list.invalidate();
      router.push(`/t/${tenantSlug}/segments/${seg.id}`);
    },
    onError: (err) => toast.error(err.message || 'Could not save segment.'),
  });
  const updateMutation = api.segments.update.useMutation({
    onSuccess: () => {
      toast.success('Changes saved.');
      if (mode.kind === 'update') {
        utils.segments.get.invalidate({ id: mode.segmentId });
      }
      utils.segments.list.invalidate();
    },
    onError: (err) => toast.error(err.message || 'Could not save changes.'),
  });

  const busy = createMutation.isPending || updateMutation.isPending;

  const onSave = (): void => {
    if (!name.trim()) {
      toast.error('Give this segment a name first.');
      return;
    }
    if (mode.kind === 'create') {
      createMutation.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        rules,
      });
    } else {
      updateMutation.mutate({
        id: mode.segmentId,
        name: name.trim(),
        description: description.trim() || null,
        rules,
      });
    }
  };

  const loadingCatalog = customFields.isLoading || tags.isLoading;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/t/${tenantSlug}/segments`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 size-4" />
              Segments
            </Button>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {mode.kind === 'create' ? 'New segment' : 'Edit segment'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Rules define which contacts belong to this segment. The count
              updates automatically when you save.
            </p>
          </div>
        </div>
        <Button onClick={onSave} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <Save className="mr-1 size-4" />
          )}
          {mode.kind === 'create' ? 'Create segment' : 'Save changes'}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Active VIPs"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional — for teammates"
                  rows={2}
                  maxLength={400}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rules</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCatalog ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <RuleBuilder
                  value={rules}
                  onChange={setRules}
                  catalog={catalog}
                  tags={tagOptions}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SegmentPreview rules={rules} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
