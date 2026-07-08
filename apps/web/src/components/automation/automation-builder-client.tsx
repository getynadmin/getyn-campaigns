'use client';

import '@xyflow/react/dist/style.css';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { ArrowLeft, Loader2, Pause, Play, Save, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import type {
  AutomationDefinition,
  AutomationNode,
  AutomationNodeType,
} from '@getyn/types';
import { validateAutomationDefinition } from '@getyn/types';

import { computeDayLabels } from './day-counter';
import { nodeTypes } from './nodes';
import { AiAssistantBar } from './ai-assistant-bar';
import { AutomationPalette } from './palette';
import { WorkflowSettingsDialog } from './workflow-settings-dialog';
import { PropertiesPanel } from './properties-panel';

/**
 * Top-level visual builder for one automation.
 *
 * State model:
 *   - Server owns the persisted definition; we hydrate once via
 *     api.automation.get.
 *   - Client keeps a mirror of nodes + edges under React Flow's
 *     controlled state.
 *   - Every mutation debounces to `updateDefinition` after ~800ms
 *     of quiet — matches the campaign design composer's autosave.
 *   - Draft/Live flips route through a dedicated `setNodeStatus`
 *     mutation so the M3 engine can hook them.
 *
 * The whole builder is a client component; the page's server
 * component only does auth-gate.
 */
export function AutomationBuilderClient({
  automationId,
  slug,
}: {
  automationId: string;
  slug: string;
}): JSX.Element {
  return (
    <ReactFlowProvider>
      <BuilderInner automationId={automationId} slug={slug} />
    </ReactFlowProvider>
  );
}

function BuilderInner({
  automationId,
  slug,
}: {
  automationId: string;
  slug: string;
}): JSX.Element {
  const utils = api.useUtils();
  const { data: row, isLoading } = api.automation.get.useQuery({ id: automationId });

  const [name, setName] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState<'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'>('DRAFT');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate from server exactly once — otherwise autosave-triggered
  // refetches would clobber in-flight edits.
  useEffect(() => {
    if (!row || hydratedRef.current) return;
    hydratedRef.current = true;
    const def = row.definition as unknown as AutomationDefinition;
    setNodes(
      (def.nodes ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })) as Node[],
    );
    setEdges(
      (def.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
      })),
    );
    setName(row.name);
    setStatus(row.status as typeof status);
  }, [row]);

  const updateDefinition = api.automation.updateDefinition.useMutation();
  const setNodeStatus = api.automation.setNodeStatus.useMutation({
    onSuccess: () => void utils.automation.get.invalidate({ id: automationId }),
  });
  const activate = api.automation.activate.useMutation({
    onSuccess: () => {
      setStatus('ACTIVE');
      toast.success('Automation is live.');
      void utils.automation.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const pause = api.automation.pause.useMutation({
    onSuccess: () => {
      setStatus('PAUSED');
      toast.success('Automation paused.');
      void utils.automation.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const rename = api.automation.rename.useMutation();

  // Debounced autosave — 800ms of quiet triggers a save. Skips the
  // first render (would just re-send server state).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const definition: AutomationDefinition = {
          nodes: nextNodes.map((n) => ({
            id: n.id,
            type: n.type as AutomationNodeType,
            position: n.position,
            data: n.data,
          })) as AutomationNode[],
          edges: nextEdges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: (e.sourceHandle as 'yes' | 'no' | null) ?? null,
          })),
        };
        updateDefinition.mutate({ id: automationId, definition });
      }, 800);
    },
    [automationId, updateDefinition],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => {
        const next = applyNodeChanges(changes, ns);
        // Only autosave on structural changes; ignore selection changes.
        if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) {
          scheduleSave(next, edges);
        }
        return next;
      });
    },
    [edges, scheduleSave],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => {
        const next = applyEdgeChanges(changes, es);
        if (changes.some((c) => c.type !== 'select')) {
          scheduleSave(nodes, next);
        }
        return next;
      });
    },
    [nodes, scheduleSave],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((es) => {
        const next = addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${connection.sourceHandle ?? 'x'}`,
          },
          es,
        );
        scheduleSave(nodes, next);
        return next;
      });
    },
    [nodes, scheduleSave],
  );

  // Drag-drop from palette.
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/x-automation-node-type') as AutomationNodeType;
      if (!type) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const newNode: Node = {
        id: `${type}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        position,
        data: defaultNodeData(type),
      };
      setNodes((ns) => {
        const next = [...ns, newNode];
        scheduleSave(next, edges);
        return next;
      });
    },
    [reactFlow, edges, scheduleSave],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Overlay day counters + validation errors onto node data.
  const dayLabels = useMemo(() => {
    const def: AutomationDefinition = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as AutomationNodeType,
        position: n.position,
        data: n.data,
      })) as AutomationNode[],
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (e.sourceHandle as 'yes' | 'no' | null) ?? null,
      })),
    };
    return computeDayLabels(def);
  }, [nodes, edges]);

  const validationIssues = useMemo(() => {
    try {
      const def: AutomationDefinition = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as AutomationNodeType,
          position: n.position,
          data: n.data,
        })) as AutomationNode[],
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: (e.sourceHandle as 'yes' | 'no' | null) ?? null,
        })),
      };
      return validateAutomationDefinition(def, { requireLiveMessageNode: false });
    } catch {
      return [];
    }
  }, [nodes, edges]);

  // Poll node-level stats every 15s while the builder is open. Only
  // fetches once we know the automation has enrollments — for fresh
  // DRAFT flows this is a no-op.
  const statsQuery = api.automation.stats.useQuery(
    { id: automationId },
    { refetchInterval: 15_000, enabled: status !== 'DRAFT' || (row?._count?.enrollments ?? 0) > 0 },
  );
  const nodeStats = statsQuery.data?.nodeStats ?? {};
  const aggregate = statsQuery.data?.aggregate;

  const enrichedNodes = useMemo(
    () =>
      nodes.map((n) => {
        const issue = validationIssues.find((i) => i.nodeId === n.id);
        const s = nodeStats[n.id];
        return {
          ...n,
          data: {
            ...n.data,
            __dayLabel: dayLabels.get(n.id) ?? (n.type === 'trigger' ? 'Day 0' : undefined),
            __hasError: issue?.message,
            __stats: s,
          },
        };
      }),
    [nodes, dayLabels, validationIssues, nodeStats],
  );

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const raw = nodes.find((n) => n.id === selectedNodeId);
    if (!raw) return null;
    return {
      id: raw.id,
      type: raw.type as AutomationNodeType,
      position: raw.position,
      data: raw.data,
    } as AutomationNode;
  }, [selectedNodeId, nodes]);

  function patchNodeData(nodeId: string, patch: Record<string, unknown>): void {
    setNodes((ns) => {
      const next = ns.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
      );
      scheduleSave(next, edges);
      return next;
    });
  }

  function handleFlipStatus(nodeId: string, next: 'DRAFT' | 'LIVE'): void {
    patchNodeData(nodeId, { status: next });
    setNodeStatus.mutate({ id: automationId, nodeId, status: next });
  }

  function handleDeleteNode(nodeId: string): void {
    setNodes((ns) => {
      const next = ns.filter((n) => n.id !== nodeId);
      const nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      setEdges(nextEdges);
      scheduleSave(next, nextEdges);
      return next;
    });
    setSelectedNodeId(null);
  }

  function applyGeneratedDefinition(def: AutomationDefinition): void {
    const nextNodes: Node[] = def.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })) as Node[];
    const nextEdges: Edge[] = def.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
    }));
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(null);
    scheduleSave(nextNodes, nextEdges);
    // Recenter the graph on the new nodes.
    setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 0);
  }

  function saveNow(): void {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const definition: AutomationDefinition = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as AutomationNodeType,
        position: n.position,
        data: n.data,
      })) as AutomationNode[],
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (e.sourceHandle as 'yes' | 'no' | null) ?? null,
      })),
    };
    updateDefinition.mutate(
      { id: automationId, definition },
      {
        onSuccess: () => toast.success('Saved.'),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (isLoading || !row) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            href={`/t/${slug}/automation/drip`}
            className="rounded-md p-1 hover:bg-muted"
            aria-label="Back to automations"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== row.name) {
                rename.mutate({ id: automationId, name: name.trim() });
              }
            }}
            className="h-8 max-w-md border-transparent bg-transparent px-2 text-sm font-semibold shadow-none hover:border-border"
          />
          <StatusPill status={status} />
          {aggregate && aggregate.total > 0 && (
            <span className="ml-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span title="Currently active enrollments">
                {aggregate.active.toLocaleString()} active
              </span>
              <span className="text-muted-foreground/50">·</span>
              <span title="Completed enrollments">
                {aggregate.completed.toLocaleString()} completed
              </span>
              {aggregate.exited + aggregate.failed > 0 && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span title="Exited or failed enrollments">
                    {(aggregate.exited + aggregate.failed).toLocaleString()}{' '}
                    exited
                  </span>
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {updateDefinition.isPending && (
            <span className="text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline size-3 animate-spin" /> Saving…
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="mr-1 size-4" /> Settings
          </Button>
          <Button variant="outline" size="sm" onClick={saveNow}>
            <Save className="mr-1 size-4" /> Save
          </Button>
          {status === 'ACTIVE' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => pause.mutate({ id: automationId })}
              disabled={pause.isPending}
            >
              <Pause className="mr-1 size-4" /> Pause
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => activate.mutate({ id: automationId })}
              disabled={activate.isPending}
            >
              <Play className="mr-1 size-4" /> Activate
            </Button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="grid flex-1 grid-cols-[220px_minmax(0,1fr)_320px] overflow-hidden">
        <aside className="border-r bg-muted/20">
          <AutomationPalette />
        </aside>
        <div
          ref={wrapperRef}
          className="relative"
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={enrichedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          <AiAssistantBar
            currentDefinition={{
              nodes: nodes.map((n) => ({
                id: n.id,
                type: n.type as AutomationNodeType,
                position: n.position,
                data: n.data,
              })) as AutomationNode[],
              edges: edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: (e.sourceHandle as 'yes' | 'no' | null) ?? null,
              })),
            }}
            onApply={applyGeneratedDefinition}
          />
        </div>
        <aside className="border-l bg-card">
          <PropertiesPanel
            node={selectedNode}
            onChange={patchNodeData}
            onFlipStatus={handleFlipStatus}
            onDeleteNode={handleDeleteNode}
            automationId={automationId}
            slug={slug}
          />
        </aside>
      </div>

      <WorkflowSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        automationId={automationId}
        automationStatus={status}
        initialSettings={
          (row?.settings ?? {}) as {
            onReply?: 'STOP' | 'CONTINUE' | 'BRANCH';
            fromName?: string | null;
            fromEmail?: string | null;
            targetSegmentId?: string | null;
          }
        }
      />
    </div>
  );
}

function defaultNodeData(type: AutomationNodeType): Record<string, unknown> {
  switch (type) {
    case 'trigger':
      return { label: 'When...', trigger: { kind: 'manual_enrollment' } };
    case 'email':
      return {
        label: 'Email',
        status: 'DRAFT',
        subject: '',
        previewText: '',
        designJson: null,
        renderedHtml: '',
        textBody: '',
      };
    case 'whatsapp':
      return {
        label: 'WhatsApp',
        status: 'DRAFT',
        templateId: null,
        phoneNumberId: null,
        variables: {},
      };
    case 'property_update':
      return {
        label: 'Update property',
        action: 'set_custom_field',
        customFieldKey: '',
        value: '',
      };
    case 'list_update':
      return { label: 'Update list', action: 'add_tag', targetId: null };
    case 'internal_alert':
      return { label: 'Internal alert', channel: 'email', target: '', message: '' };
    case 'delay':
      return {
        label: 'Wait',
        mode: 'relative',
        amount: 1,
        unit: 'days',
        absoluteAt: null,
        weekday: null,
        hourUtc: null,
      };
    case 'split':
      return {
        label: 'If / else',
        condition: { kind: 'opened_previous_email', nodeId: null },
      };
    case 'exit':
      return { label: 'End', reason: '' };
  }
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    ACTIVE: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    PAUSED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ARCHIVED: 'bg-muted text-muted-foreground opacity-70',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${map[status]}`}>
      {status}
    </span>
  );
}
