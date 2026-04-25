'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowRight,
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';

import type { EmailTemplateCategoryValue } from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { cn } from '@/lib/utils';

const CATEGORY_LABEL: Record<EmailTemplateCategoryValue, string> = {
  NEWSLETTER: 'Newsletter',
  ANNOUNCEMENT: 'Announcement',
  PROMOTIONAL: 'Promotional',
  TRANSACTIONAL: 'Transactional',
  EVENT: 'Event',
  WELCOME: 'Welcome',
  OTHER: 'Other',
};

const CATEGORY_TONE: Record<EmailTemplateCategoryValue, string> = {
  WELCOME: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  NEWSLETTER: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  PROMOTIONAL: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ANNOUNCEMENT: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  TRANSACTIONAL: 'bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-200',
  EVENT: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  OTHER: 'bg-muted text-muted-foreground',
};

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useMemo(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function TemplatesLibraryClient({
  tenantSlug,
  canCreate,
  canDelete,
}: {
  tenantSlug: string;
  canCreate: boolean;
  canDelete: boolean;
}): JSX.Element {
  const router = useRouter();
  const utils = api.useUtils();

  const [scope, setScope] = useState<'ALL' | 'SYSTEM' | 'TENANT'>('ALL');
  const [category, setCategory] = useState<
    EmailTemplateCategoryValue | 'ALL'
  >('ALL');
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch, 300);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading } = api.emailTemplate.list.useQuery({
    scope,
    category: category === 'ALL' ? undefined : category,
    search: search || undefined,
    limit: 24,
  });

  const duplicate = api.emailTemplate.duplicate.useMutation({
    onSuccess: (row) => {
      toast.success(`Created "${row.name}". Opening editor…`);
      void utils.emailTemplate.list.invalidate();
      router.push(`/t/${tenantSlug}/templates/${row.id}/design`);
    },
    onError: (err) => toast.error(err.message ?? 'Could not duplicate.'),
  });

  const del = api.emailTemplate.delete.useMutation({
    onSuccess: () => {
      void utils.emailTemplate.list.invalidate();
      toast.success('Template deleted.');
    },
    onError: (err) => toast.error(err.message ?? 'Could not delete.'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border p-0.5 text-xs">
          {(['ALL', 'TENANT', 'SYSTEM'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={
                scope === s
                  ? 'rounded bg-foreground px-3 py-1.5 font-medium text-background'
                  : 'rounded px-3 py-1.5 text-muted-foreground hover:text-foreground'
              }
            >
              {s === 'ALL'
                ? 'All'
                : s === 'TENANT'
                  ? 'My templates'
                  : 'System templates'}
            </button>
          ))}
        </div>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search by name or description"
            className="pl-9"
          />
        </div>
        <Select
          value={category}
          onValueChange={(v) =>
            setCategory(v as EmailTemplateCategoryValue | 'ALL')
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            <SelectItem value="WELCOME">Welcome</SelectItem>
            <SelectItem value="NEWSLETTER">Newsletter</SelectItem>
            <SelectItem value="PROMOTIONAL">Promotional</SelectItem>
            <SelectItem value="ANNOUNCEMENT">Announcement</SelectItem>
            <SelectItem value="EVENT">Event</SelectItem>
            <SelectItem value="TRANSACTIONAL">Transactional</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground">
        {data ? `${data.total} template${data.total === 1 ? '' : 's'}` : '—'}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))
        ) : !data || data.items.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto mb-2 size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                No templates match the current filters.
              </p>
            </CardContent>
          </Card>
        ) : (
          data.items.map((tpl) => {
            const cat = tpl.category as EmailTemplateCategoryValue;
            const isSystem = tpl.tenantId === null;
            return (
              <Card
                key={tpl.id}
                className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md"
              >
                <div className="aspect-[1.6/1] border-b bg-gradient-to-br from-muted/40 to-muted/10 p-6">
                  {tpl.thumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={tpl.thumbnailUrl}
                      alt={tpl.name}
                      className="h-full w-full rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <FileText className="size-8 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{tpl.name}</CardTitle>
                    {canCreate || (canDelete && !isSystem) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="-mr-2 -mt-1 size-7 p-0 opacity-60 group-hover:opacity-100"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canCreate ? (
                            <DropdownMenuItem
                              onClick={() => duplicate.mutate({ id: tpl.id })}
                            >
                              <Copy className="mr-2 size-3.5" />
                              Duplicate
                            </DropdownMenuItem>
                          ) : null}
                          {!isSystem && canCreate ? (
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/t/${tenantSlug}/templates/${tpl.id}/design`}
                              >
                                <Pencil className="mr-2 size-3.5" />
                                Edit
                              </Link>
                            </DropdownMenuItem>
                          ) : null}
                          {!isSystem && canDelete ? (
                            <DropdownMenuItem
                              className="text-rose-600"
                              onClick={() => setConfirmDeleteId(tpl.id)}
                            >
                              <Trash2 className="mr-2 size-3.5" />
                              Delete
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        CATEGORY_TONE[cat],
                      )}
                    >
                      {CATEGORY_LABEL[cat]}
                    </span>
                    {isSystem ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <Sparkles className="size-3" />
                        System
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-3">
                  {tpl.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {tpl.description}
                    </p>
                  ) : null}
                </CardContent>
                <div className="border-t bg-muted/20 px-4 py-2">
                  {isSystem ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => duplicate.mutate({ id: tpl.id })}
                      disabled={!canCreate || duplicate.isPending}
                    >
                      Use template
                      <ArrowRight className="ml-2 size-3.5" />
                    </Button>
                  ) : (
                    <Button asChild variant="ghost" size="sm" className="w-full">
                      <Link
                        href={`/t/${tenantSlug}/templates/${tpl.id}/design`}
                      >
                        Open in editor
                        <ArrowRight className="ml-2 size-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => (o ? null : setConfirmDeleteId(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this template?</DialogTitle>
            <DialogDescription>
              Existing campaigns that referenced this template keep their
              `designJson` snapshot — they're unaffected. Future "use
              template" actions won't see it anymore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteId) {
                  del.mutate({ id: confirmDeleteId });
                  setConfirmDeleteId(null);
                }
              }}
              disabled={del.isPending}
            >
              Delete template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
