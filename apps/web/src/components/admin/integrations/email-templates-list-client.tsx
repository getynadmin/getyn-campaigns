'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Pencil } from 'lucide-react';

import type { SystemEmailTemplateCategory } from '@getyn/db';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { adminApi } from '@/lib/admin-trpc';

const CATEGORIES: { value: SystemEmailTemplateCategory | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TRANSACTIONAL', label: 'Transactional' },
  { value: 'NOTIFICATION', label: 'Notification' },
  { value: 'MARKETING', label: 'Marketing' },
];

const CATEGORY_CLS: Record<SystemEmailTemplateCategory, string> = {
  TRANSACTIONAL:
    'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  NOTIFICATION:
    'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  MARKETING:
    'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
};

export function EmailTemplatesListClient(): JSX.Element {
  const [category, setCategory] = useState<SystemEmailTemplateCategory | 'ALL'>(
    'ALL',
  );
  const { data, isLoading } = adminApi.integrations.emailTemplate.list.useQuery({
    category: category === 'ALL' ? undefined : category,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Category:</Label>
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as typeof category)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No templates in this category.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {data.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/integrations/email-templates/${t.id}`}
                className="flex items-start gap-4 px-5 py-4 hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <p className="font-medium">{t.name}</p>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t.slug}
                    </code>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        CATEGORY_CLS[t.category as SystemEmailTemplateCategory]
                      }`}
                    >
                      {t.category}
                    </span>
                    {!t.enabled && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.subject}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Updated {new Date(t.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <Pencil className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
