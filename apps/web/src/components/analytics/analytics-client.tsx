'use client';

import { useState } from 'react';
import {
  BarChart3,
  Bot,
  Mail,
  MessageSquare,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import {
  LineChart,
  RangePicker,
  StatTile,
  fmt,
  pct,
} from './mini-charts';

type Tab =
  | 'overview'
  | 'email'
  | 'whatsapp'
  | 'automations'
  | 'agents'
  | 'audience'
  | 'deliverability';

const TABS: Array<{ key: Tab; label: string; icon: LucideIcon }> = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'email', label: 'Email campaigns', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp campaigns', icon: MessageSquare },
  { key: 'automations', label: 'Drip / Flows', icon: Workflow },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'audience', label: 'Audience', icon: Users },
  { key: 'deliverability', label: 'Deliverability', icon: ShieldCheck },
];

export function AnalyticsClient(): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const range = { days };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        <RangePicker value={days} onChange={setDays} />
      </div>

      {tab === 'overview' ? <OverviewTab range={range} /> : null}
      {tab === 'email' ? <EmailTab range={range} /> : null}
      {tab === 'whatsapp' ? <WhatsappTab range={range} /> : null}
      {tab === 'automations' ? <AutomationsTab range={range} /> : null}
      {tab === 'agents' ? <AgentsTab range={range} /> : null}
      {tab === 'audience' ? <AudienceTab range={range} /> : null}
      {tab === 'deliverability' ? <DeliverabilityTab range={range} /> : null}
    </div>
  );
}

function Empty({ title, note }: { title: string; note?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function OverviewTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.overview.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={3} />;
  const d = q.data;
  const labels = d.trend.map((t) => t.day.slice(5)); // MM-DD
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Emails sent" value={fmt(d.email.sent)} tone="info" />
        <StatTile label="Opens" value={fmt(d.email.opened)} sub={pct(d.email.openRate)} />
        <StatTile label="Clicks" value={fmt(d.email.clicked)} sub={pct(d.email.clickRate)} tone="good" />
        <StatTile label="Bounces" value={fmt(d.email.bounced)} sub={pct(d.email.bounceRate)} tone={d.email.bounceRate > 0.05 ? 'bad' : 'default'} />
        <StatTile label="Complaints" value={fmt(d.email.complained)} tone={d.email.complained > 0 ? 'warn' : 'default'} />
        <StatTile label="Agent conv." value={fmt(d.agents.total)} sub={`${d.agents.active} active`} />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-sm font-medium">Activity over time</p>
        {d.trend.length === 0 ? (
          <Empty title="No sends in this period." />
        ) : (
          <LineChart
            labels={labels}
            series={[
              { name: 'Sent', color: '#0ea5e9', values: d.trend.map((t) => t.sent) },
              { name: 'Opened', color: '#8b5cf6', values: d.trend.map((t) => t.opened) },
              { name: 'Clicked', color: '#10b981', values: d.trend.map((t) => t.clicked) },
            ]}
          />
        )}
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Top campaigns by clicks</p>
        </div>
        {d.topCampaigns.length === 0 ? (
          <div className="p-6">
            <Empty title="No click activity in this period." />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Campaign</th>
                <th className="px-4 py-2 text-right">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {d.topCampaigns.map((c) => (
                <tr key={c.campaignId} className="border-t">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 text-right font-medium">{fmt(c.clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EmailTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.emailCampaigns.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={3} />;
  if (q.data.length === 0)
    return <Empty title="No email campaigns in this range." />;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Campaign</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Sent</th>
            <th className="px-3 py-2 text-right">Delivered</th>
            <th className="px-3 py-2 text-right">Opens</th>
            <th className="px-3 py-2 text-right">Clicks</th>
            <th className="px-3 py-2 text-right">Bounces</th>
            <th className="px-3 py-2 text-right">Unsubs</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="px-3 py-2">
                <div className="font-medium">{c.name}</div>
                {c.subject ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {c.subject}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{c.status}</td>
              <td className="px-3 py-2 text-right">{fmt(c.sent)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.delivered)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.opened)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.clicked)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.bounced)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.unsubscribed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WhatsappTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.whatsappCampaigns.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={3} />;
  if (q.data.length === 0)
    return <Empty title="No WhatsApp campaigns in this range." />;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Campaign</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Queued</th>
            <th className="px-3 py-2 text-right">Sent</th>
            <th className="px-3 py-2 text-right">Delivered</th>
            <th className="px-3 py-2 text-right">Read</th>
            <th className="px-3 py-2 text-right">Failed</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{c.status}</td>
              <td className="px-3 py-2 text-right">{fmt(c.queued)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.sent)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.delivered)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.read)}</td>
              <td className="px-3 py-2 text-right">{fmt(c.failed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationsTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.automations.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={3} />;
  if (q.data.length === 0)
    return <Empty title="No automations yet." />;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Automation</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Enrolled</th>
            <th className="px-3 py-2 text-right">Active</th>
            <th className="px-3 py-2 text-right">Completed</th>
            <th className="px-3 py-2 text-right">Exited</th>
            <th className="px-3 py-2 text-right">Failed</th>
            <th className="px-3 py-2 text-right">Completion</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((a) => {
            const conv = a.total === 0 ? 0 : a.completed / a.total;
            return (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{a.status}</td>
                <td className="px-3 py-2 text-right">{fmt(a.total)}</td>
                <td className="px-3 py-2 text-right">{fmt(a.active)}</td>
                <td className="px-3 py-2 text-right">{fmt(a.completed)}</td>
                <td className="px-3 py-2 text-right">{fmt(a.exited)}</td>
                <td className="px-3 py-2 text-right">{fmt(a.failed)}</td>
                <td className="px-3 py-2 text-right">{pct(conv)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AgentsTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.agents.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={2} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Conversations" value={fmt(d.totalConversations)} />
        <StatTile label="Active" value={fmt(d.byStatus.ACTIVE ?? 0)} tone="info" />
        <StatTile
          label="Completed drafts"
          value={fmt(d.byStatus.COMPLETED_DRAFT_CREATED ?? 0)}
          tone="good"
        />
        <StatTile label="Pending approvals" value={fmt(d.pendingApprovals)} tone={d.pendingApprovals > 0 ? 'warn' : 'default'} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-sm font-medium">By status</p>
          <ul className="space-y-1 text-sm">
            {Object.entries(d.byStatus).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{fmt(v)}</span>
              </li>
            ))}
            {Object.keys(d.byStatus).length === 0 ? (
              <li className="text-muted-foreground">No activity.</li>
            ) : null}
          </ul>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-sm font-medium">By channel</p>
          <ul className="space-y-1 text-sm">
            {Object.entries(d.byChannel).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{fmt(v)}</span>
              </li>
            ))}
            {Object.keys(d.byChannel).length === 0 ? (
              <li className="text-muted-foreground">No activity.</li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

function AudienceTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.audience.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={2} />;
  const d = q.data;
  const labels = d.trend.map((t) => t.day.slice(5));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Total contacts" value={fmt(d.totalContacts)} />
        <StatTile label="New this period" value={fmt(d.newContacts)} tone="good" />
        <StatTile label="Suppressed" value={fmt(d.suppressed)} tone={d.suppressed > 0 ? 'warn' : 'default'} />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-2 text-sm font-medium">New contacts over time</p>
        {d.trend.length === 0 ? (
          <Empty title="No new contacts in this period." />
        ) : (
          <LineChart
            labels={labels}
            series={[
              { name: 'New contacts', color: '#10b981', values: d.trend.map((t) => t.count) },
            ]}
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Top segments</p>
          <ul className="space-y-1 text-sm">
            {d.topSegments.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span className="truncate text-muted-foreground">{s.name}</span>
                <span className="font-medium">{fmt(s.count)}</span>
              </li>
            ))}
            {d.topSegments.length === 0 ? (
              <li className="text-muted-foreground">No segments yet.</li>
            ) : null}
          </ul>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-sm font-medium">Top tags</p>
          <ul className="space-y-1 text-sm">
            {d.topTags.map((t) => (
              <li key={t.id} className="flex items-center justify-between">
                <span className="truncate text-muted-foreground">{t.name}</span>
                <span className="font-medium">{fmt(t.count)}</span>
              </li>
            ))}
            {d.topTags.length === 0 ? (
              <li className="text-muted-foreground">No tags yet.</li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

function DeliverabilityTab({ range }: { range: { days: number } }): JSX.Element {
  const q = api.analytics.deliverability.useQuery(range);
  if (q.isLoading || !q.data) return <LoadingGrid rows={2} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Sent" value={fmt(d.sent)} />
        <StatTile
          label="Bounces"
          value={fmt(d.bounced)}
          sub={pct(d.bounceRate)}
          tone={d.bounceRate > 0.05 ? 'bad' : 'default'}
        />
        <StatTile
          label="Complaints"
          value={fmt(d.complained)}
          sub={pct(d.complaintRate)}
          tone={d.complaintRate > 0.001 ? 'warn' : 'default'}
        />
        <StatTile
          label="Reputation"
          value={d.bounceRate > 0.05 || d.complaintRate > 0.001 ? 'At risk' : 'Healthy'}
          tone={d.bounceRate > 0.05 || d.complaintRate > 0.001 ? 'warn' : 'good'}
        />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Sending domains</p>
        </div>
        {d.domains.length === 0 ? (
          <div className="p-6">
            <Empty title="No sending domains configured." />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Domain</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Verified</th>
                <th className="px-4 py-2">Last checked</th>
              </tr>
            </thead>
            <tbody>
              {d.domains.map((dom) => (
                <tr key={dom.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{dom.domain}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{dom.status}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {dom.verifiedAt
                      ? new Date(dom.verifiedAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {dom.lastCheckedAt
                      ? new Date(dom.lastCheckedAt).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LoadingGrid({ rows }: { rows: number }): JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

