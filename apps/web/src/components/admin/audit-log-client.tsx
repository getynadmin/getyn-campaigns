'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/admin-trpc';

export function AdminAuditLogClient(): JSX.Element {
  const [actionFilter, setActionFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const { data, isLoading } = adminApi.auditLog.list.useQuery({
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(tenantFilter ? { targetTenantId: tenantFilter } : {}),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Filter by action (substring)…"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Tenant id…"
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          className="max-w-xs"
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-60" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {(data?.items ?? []).map((row) => (
            <li
              key={row.id}
              className="space-y-1 px-4 py-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{row.action}</span>
                <span className="text-muted-foreground">
                  by {row.staffEmail}
                </span>
                <span className="text-muted-foreground">
                  · {new Date(row.createdAt).toLocaleString()}
                </span>
              </div>
              {row.targetTenantId && (
                <p className="text-muted-foreground">
                  tenant <code>{row.targetTenantId}</code>
                  {row.targetEntityId && (
                    <>
                      {' '}· entity <code>{row.targetEntityId}</code>
                    </>
                  )}
                </p>
              )}
              {row.reason && (
                <p className="italic text-muted-foreground">"{row.reason}"</p>
              )}
            </li>
          ))}
          {(data?.items.length ?? 0) === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No audit entries yet.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
