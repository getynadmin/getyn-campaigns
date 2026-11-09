import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bot,
  Gauge,
  LayoutGrid,
  LineChart as LineChartIcon,
  Radio,
  Rocket,
  ShieldAlert,
  Trophy,
  Users,
} from 'lucide-react';

import { AgentActivityWidget } from './widgets/agent-activity';
import { AudienceGrowthWidget } from './widgets/audience-growth';
import { AutomationEnrolmentWidget } from './widgets/automation-enrolment';
import { CampaignsPerformanceWidget } from './widgets/campaigns-performance';
import { ChannelHealthWidget } from './widgets/channel-health';
import { KpiTilesWidget } from './widgets/kpi-tiles';
import { QuickActionsWidget } from './widgets/quick-actions';
import { RecentActivityWidget } from './widgets/recent-activity';
import { SuppressionDeliverabilityWidget } from './widgets/suppression-deliverability';
import { TopCampaignsWidget } from './widgets/top-campaigns';

export type WidgetSize = 'sm' | 'md' | 'lg';

export type WidgetId =
  | 'kpi_tiles'
  | 'channel_health'
  | 'recent_activity'
  | 'campaigns_performance'
  | 'top_campaigns'
  | 'agent_activity'
  | 'audience_growth'
  | 'suppression_deliverability'
  | 'automation_enrolment'
  | 'quick_actions';

export type TabKey = 'overview' | 'campaigns' | 'agents' | 'audience';

export type WidgetProps = {
  tenantSlug: string;
  days: number;
};

export type WidgetDef = {
  id: WidgetId;
  title: string;
  description: string;
  icon: LucideIcon;
  defaultSize: WidgetSize;
  component: React.ComponentType<WidgetProps>;
};

/**
 * Registry of every dashboard widget. Add a widget = add an entry
 * here + a component file under ./widgets/. The tab presets below
 * only reference ids from this map so an unknown id is caught at
 * TypeScript level.
 */
export const WIDGETS: Record<WidgetId, WidgetDef> = {
  kpi_tiles: {
    id: 'kpi_tiles',
    title: 'Key metrics',
    description: 'Contacts, sends, open rate, click rate — vs prior period.',
    icon: Gauge,
    defaultSize: 'lg',
    component: KpiTilesWidget,
  },
  channel_health: {
    id: 'channel_health',
    title: 'Channel health',
    description: 'Email, WhatsApp, SMS — connected or not.',
    icon: Radio,
    defaultSize: 'md',
    component: ChannelHealthWidget,
  },
  quick_actions: {
    id: 'quick_actions',
    title: 'Quick actions',
    description: 'Jump straight into creating things.',
    icon: Rocket,
    defaultSize: 'md',
    component: QuickActionsWidget,
  },
  campaigns_performance: {
    id: 'campaigns_performance',
    title: 'Campaigns performance',
    description: 'Opens + clicks over time.',
    icon: LineChartIcon,
    defaultSize: 'lg',
    component: CampaignsPerformanceWidget,
  },
  top_campaigns: {
    id: 'top_campaigns',
    title: 'Top-performing campaigns',
    description: 'Last 10 campaigns by open rate.',
    icon: Trophy,
    defaultSize: 'md',
    component: TopCampaignsWidget,
  },
  recent_activity: {
    id: 'recent_activity',
    title: 'Recent activity',
    description: 'Latest sends, replies, enrolments, approvals.',
    icon: Activity,
    defaultSize: 'md',
    component: RecentActivityWidget,
  },
  agent_activity: {
    id: 'agent_activity',
    title: 'Agent activity',
    description: 'Autonomous agents — conversations + approvals.',
    icon: Bot,
    defaultSize: 'md',
    component: AgentActivityWidget,
  },
  audience_growth: {
    id: 'audience_growth',
    title: 'Audience growth',
    description: 'Contacts + segments over the last 90 days.',
    icon: Users,
    defaultSize: 'md',
    component: AudienceGrowthWidget,
  },
  suppression_deliverability: {
    id: 'suppression_deliverability',
    title: 'Suppression & deliverability',
    description: 'Bounces, complaints, unsubs — with a score.',
    icon: ShieldAlert,
    defaultSize: 'md',
    component: SuppressionDeliverabilityWidget,
  },
  automation_enrolment: {
    id: 'automation_enrolment',
    title: 'Automation enrolment',
    description: 'Active drip / flow enrolments + completion.',
    icon: BarChart3,
    defaultSize: 'md',
    component: AutomationEnrolmentWidget,
  },
};

/**
 * Default widget sets per tab. User-customised layouts override this
 * on a per-tab basis — reordered / hidden widgets are stored in
 * TenantUserPreference.dashboardLayout.
 */
export const TAB_PRESETS: Record<
  TabKey,
  { title: string; icon: LucideIcon; widgets: WidgetId[] }
> = {
  overview: {
    title: 'Overview',
    icon: LayoutGrid,
    widgets: [
      'kpi_tiles',
      'channel_health',
      'quick_actions',
      'campaigns_performance',
      'top_campaigns',
      'agent_activity',
      'recent_activity',
      'audience_growth',
      'suppression_deliverability',
      'automation_enrolment',
    ],
  },
  campaigns: {
    title: 'Campaigns',
    icon: LineChartIcon,
    widgets: [
      'kpi_tiles',
      'campaigns_performance',
      'top_campaigns',
      'suppression_deliverability',
      'quick_actions',
    ],
  },
  agents: {
    title: 'Agents',
    icon: Bot,
    widgets: [
      'agent_activity',
      'automation_enrolment',
      'recent_activity',
      'channel_health',
    ],
  },
  audience: {
    title: 'Audience',
    icon: Users,
    widgets: [
      'audience_growth',
      'kpi_tiles',
      'channel_health',
      'quick_actions',
    ],
  },
};
