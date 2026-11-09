'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, EyeOff, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import { WidgetCard } from './widget-card';
import {
  TAB_PRESETS,
  WIDGETS,
  type TabKey,
  type WidgetId,
} from './widget-catalog';

type Layout = Record<TabKey, { order: WidgetId[]; hidden: WidgetId[] }>;

function defaultLayout(): Layout {
  return {
    overview: { order: TAB_PRESETS.overview.widgets, hidden: [] },
    campaigns: { order: TAB_PRESETS.campaigns.widgets, hidden: [] },
    agents: { order: TAB_PRESETS.agents.widgets, hidden: [] },
    audience: { order: TAB_PRESETS.audience.widgets, hidden: [] },
  };
}

function normalise(
  server:
    | { tabs?: Record<string, { order?: string[]; hidden?: string[] }> }
    | null
    | undefined,
): Layout {
  const base = defaultLayout();
  if (!server?.tabs) return base;
  for (const tab of Object.keys(base) as TabKey[]) {
    const s = server.tabs[tab];
    if (!s) continue;
    const valid = (s.order ?? []).filter((id): id is WidgetId => id in WIDGETS);
    const hidden = (s.hidden ?? []).filter(
      (id): id is WidgetId => id in WIDGETS,
    );
    // Preserve user's order; append any new preset widgets they
    // haven't seen yet so new widgets surface instead of being lost.
    const missing = base[tab].order.filter(
      (id) => !valid.includes(id) && !hidden.includes(id),
    );
    base[tab] = { order: [...valid, ...missing], hidden };
  }
  return base;
}

const TABS: TabKey[] = ['overview', 'campaigns', 'agents', 'audience'];
const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

/**
 * Main dashboard — tab strip + date-range chip + widget grid. The
 * grid is drag-and-drop in Customise mode; order + hidden set are
 * persisted per-user-per-tenant via `dashboardPrefs.setDashboardLayout`.
 * `kind`-aware safety: unknown widget ids are dropped on normalise,
 * new preset widgets are appended automatically.
 */
export function DashboardGrid({
  tenantSlug,
}: {
  tenantSlug: string;
}): JSX.Element {
  const prefs = api.dashboardPrefs.get.useQuery();
  const utils = api.useUtils();
  const save = api.dashboardPrefs.setDashboardLayout.useMutation({
    onSuccess: () => utils.dashboardPrefs.get.invalidate(),
  });
  const reset = api.dashboardPrefs.resetDashboardLayout.useMutation({
    onSuccess: () => {
      utils.dashboardPrefs.get.invalidate();
      toast.success('Dashboard layout reset to default.');
    },
  });

  const [tab, setTab] = useState<TabKey>('overview');
  const [days, setDays] = useState<number>(30);
  const [editing, setEditing] = useState(false);
  const [addPanel, setAddPanel] = useState(false);
  const [layout, setLayout] = useState<Layout>(() => defaultLayout());

  // Hydrate from server on load; keep local copy in sync when server
  // version changes (e.g. after reset).
  useEffect(() => {
    if (prefs.data === undefined) return;
    setLayout(
      normalise(
        prefs.data.dashboardLayout as {
          tabs?: Record<string, { order?: string[]; hidden?: string[] }>;
        } | null,
      ),
    );
  }, [prefs.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const currentOrder = layout[tab].order.filter(
    (id) => !layout[tab].hidden.includes(id),
  );

  const persist = (next: Layout): void => {
    setLayout(next);
    save.mutate({ tabs: next as unknown as Record<string, { order: string[]; hidden: string[] }> });
  };

  const onDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = [...currentOrder];
    const from = ids.indexOf(active.id as WidgetId);
    const to = ids.indexOf(over.id as WidgetId);
    if (from === -1 || to === -1) return;
    const reordered = arrayMove(ids, from, to);
    const nextTab = {
      order: [...reordered, ...layout[tab].hidden],
      hidden: layout[tab].hidden,
    };
    persist({ ...layout, [tab]: nextTab });
  };

  const hide = (id: WidgetId): void => {
    const nextTab = {
      order: layout[tab].order.filter((w) => w !== id),
      hidden: [...layout[tab].hidden, id],
    };
    persist({ ...layout, [tab]: nextTab });
  };

  const show = (id: WidgetId): void => {
    const nextTab = {
      order: [...layout[tab].order.filter((w) => w !== id), id],
      hidden: layout[tab].hidden.filter((w) => w !== id),
    };
    persist({ ...layout, [tab]: nextTab });
  };

  const availableToAdd = useMemo(
    () => (Object.keys(WIDGETS) as WidgetId[]).filter((id) => !currentOrder.includes(id)),
    [currentOrder],
  );

  return (
    <div className="space-y-5">
      {/* Tabs + filters bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((k) => {
            const preset = TAB_PRESETS[k];
            const Icon = preset.icon;
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {preset.title}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <div className="inline-flex rounded-lg border bg-card p-0.5">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  days === d
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d}d
              </button>
            ))}
          </div>
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setAddPanel((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <Plus className="size-3.5" />
                Add widget
              </button>
              <button
                type="button"
                onClick={() => reset.mutate()}
                className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600"
              >
                <Check className="size-3.5" />
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings2 className="size-3.5" />
              Customise
            </button>
          )}
        </div>
      </div>

      {editing && addPanel && availableToAdd.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Available widgets
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {availableToAdd.map((id) => {
              const def = WIDGETS[id];
              const Icon = def.icon;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => show(id)}
                  className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{def.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {def.description}
                    </p>
                  </div>
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {editing && layout[tab].hidden.length > 0 && !addPanel && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <EyeOff className="mr-1.5 inline size-3.5" />
          {layout[tab].hidden.length} widget
          {layout[tab].hidden.length === 1 ? '' : 's'} hidden on this tab —
          click "Add widget" to bring one back.
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={currentOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {currentOrder.map((id) => (
              <SortableWidget
                key={id}
                id={id}
                tenantSlug={tenantSlug}
                days={days}
                editing={editing}
                onHide={() => hide(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableWidget({
  id,
  tenantSlug,
  days,
  editing,
  onHide,
}: {
  id: WidgetId;
  tenantSlug: string;
  days: number;
  editing: boolean;
  onHide: () => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const def = WIDGETS[id];
  const Component = def.component;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={def.defaultSize === 'lg' ? 'md:col-span-2 xl:col-span-4' : def.defaultSize === 'md' ? 'xl:col-span-2' : ''}>
      <WidgetCard
        title={def.title}
        description={def.description}
        size={def.defaultSize}
        editing={editing}
        onHide={onHide}
        dragHandleProps={{ ...attributes, ...listeners }}
      >
        <Component tenantSlug={tenantSlug} days={days} />
      </WidgetCard>
    </div>
  );
}
