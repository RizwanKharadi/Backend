/**
 * TallyFin — Dashboard domain types.
 * Components are prop-driven against these interfaces so the screen can be fed
 * either mock data or live Redux/report data without component changes.
 */

export interface SubscriptionState {
  type: 'trial' | 'active' | 'expired';
  /** Literal label. Ignored when `labelKey` is set. */
  label?: string;
  /** Translation key — preferred, since this is built outside React. */
  labelKey?: string;
  labelParams?: Record<string, unknown>;
}

export interface SyncState {
  online: boolean;
  label: string;
}

export interface HeaderData {
  greeting: string;
  userName: string;
  companyName: string;
  sync: SyncState;
  subscription: SubscriptionState;
  unreadNotifications: number;
}

export interface HeroNetWorth {
  value: string;
  trendLabel: string;
  trendPositive: boolean;
  /** Plain-English breakdown of what the figure adds up, shown on the card. */
  formulaLabel?: string;
}

export interface HeroReceivables {
  value: string;
  partiesLabel: string;
  /** 0..1 completion of the progress ring. */
  progress: number;
  ringCenterValue: string;
  ringCenterLabel: string;
}

export type KpiAccent = 'green' | 'orange' | 'purple' | 'red';

export interface KpiCardData {
  id: string;
  label: string;
  value: string;
  deltaLabel: string;
  /** undefined = neutral/contextual (no up/down arrow, muted color). */
  deltaPositive?: boolean;
  icon: string;
  accent: KpiAccent;
  /** Omit (or <2 points) to hide the sparkline when no real series exists. */
  spark?: number[];
}

export type SalesPeriod = '7D' | '30D' | '90D';

export interface SalesSeries {
  labels: string[];
  values: number[];
}

export interface SalesTrendData {
  value: string;
  growthLabel: string;
  growthPositive: boolean;
  series: Record<SalesPeriod, SalesSeries>;
}

export type QuickActionKey = 'salesInvoice' | 'receipt' | 'payment' | 'expense';

export interface QuickAction {
  key: QuickActionKey;
  title: string;
  icon: string;
  gradient: [string, string];
}

export type OutstandingStatus = 'overdue' | 'dueSoon' | 'paid';

export interface OutstandingItem {
  id: string;
  name: string;
  amount: string;
  status: OutstandingStatus;
}

export type DashboardTab = 'dashboard' | 'transactions' | 'inventory' | 'reports';

export interface NavItem {
  key: DashboardTab;
  /** Translation key; the tab bar resolves it at render. */
  labelKey: string;
  icon: string;
}

export interface DashboardData {
  header: HeaderData;
  netWorth: HeroNetWorth;
  receivables: HeroReceivables;
  kpis: KpiCardData[];
  salesTrend: SalesTrendData;
  quickActions: QuickAction[];
  topOutstanding: OutstandingItem[];
}
