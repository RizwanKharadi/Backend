/**
 * PremiumDashboardScreen — TallyFin 2026 fintech dashboard, wired to LIVE data.
 *
 * Data sources:
 *  - reportService.getDashboardSummary(companyId)      → KPIs, hero figures, 7D trend
 *  - reportService.getOutstandingReceivable(companyId) → Top Outstanding Receivables list
 *  - reportService.getSalesReport(...)                 → 30D / 90D sales trend (lazy)
 *  - billingService.getStatus()                        → subscription / trial badge
 *  - Redux: auth (user), sync, inventory, notifications, company
 *
 * No fabricated numbers: where the API has no series (per-KPI history other than
 * revenue), sparklines/deltas are simply omitted rather than faked.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HeaderSection from '../components/HeaderSection';
import HeroCard from '../components/HeroCard';
import KpiCard from '../components/KpiCard';
import SalesChart from '../components/SalesChart';
import OutstandingList from '../components/OutstandingList';
import FloatingVoucherButton from '../components/FloatingVoucherButton';
import BottomNavigation from '../components/BottomNavigation';

import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { navItems } from '../data/dashboardMockData';
import { navigateToReportTab, navigateToTab } from '../navigation/reportNavigation';
import {
  DashboardTab,
  HeaderData,
  KpiCardData,
  OutstandingItem,
  SalesPeriod,
  SalesSeries,
  SubscriptionState,
} from '../types/dashboard';

import { AppDispatch } from '../store';
import {
  useAuth,
  useSync,
  useInventory,
  useNotification,
  useCompany,
} from '../store/hooks';
import { getSyncStatus } from '../store/slices/syncSlice';
import { fetchInventoryStats } from '../store/slices/inventorySlice';
import { fetchUnreadCount } from '../store/slices/notificationSlice';
import {
  reportService,
  DashboardSummaryData,
  OutstandingLedgerSummary,
} from '../services/reportService';
import { billingService } from '../services/billingService';
import { offlineCacheService } from '../services/offlineCacheService';
import {
  formatIndianCompact,
  formatRelativeTime,
  getGreeting,
  parseLocalDateString,
} from '../utils/formatters';

const SCREEN_PADDING = spacing.md;
const MIN_AUTO_RELOAD_MS = 45_000;

const TAB_ROUTE: Record<Exclude<DashboardTab, 'dashboard'>, string> = {
  transactions: 'Transactions',
  inventory: 'Inventory',
  reports: 'Reports',
};

const EMPTY_SERIES: SalesSeries = { labels: [], values: [] };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Evenly sample up to `maxLabels` labels; blank the rest so the axis stays readable. */
function sampleLabels(labels: string[], maxLabels: number): string[] {
  if (labels.length <= maxLabels) return labels;
  const step = Math.ceil(labels.length / maxLabels);
  return labels.map((l, i) => (i % step === 0 ? l : ''));
}

// Hermes on Android ships without full Intl, so
// `toLocaleDateString(undefined, { weekday: 'short' })` yields "undefined"
// instead of a weekday. Use a fixed table — chart axis labels must not depend
// on the JS engine's locale support.
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** '2026-08-06' → '6 Aug'. Fixed tables for the same Hermes/Intl reason. */
function formatDayMonth(iso: string): string {
  const d = parseLocalDateString(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

function trendToSeries(rows: DashboardSummaryData['salesTrend']): SalesSeries {
  const labels: string[] = [];
  const values: number[] = [];
  for (const row of rows || []) {
    const d = parseLocalDateString(row.date);
    labels.push(Number.isNaN(d.getTime()) ? '' : WEEKDAY_LABELS[d.getDay()]);
    values.push(row.amount || 0);
  }
  return { labels, values };
}

function signedCompact(amount: number): string {
  const sign = amount < 0 ? '-' : '+';
  return `${sign}${formatIndianCompact(Math.abs(amount))}`;
}

function buildSubscription(
  billing: { subscription?: { status?: string; trialEndsAt?: string } } | null
): SubscriptionState {
  const sub = billing?.subscription;
  if (sub?.status === 'active') return { type: 'active', label: 'Subscription Active' };
  if (sub?.status === 'past_due') return { type: 'expired', label: 'Payment due' };
  if (sub?.status === 'trial' && sub.trialEndsAt) {
    const days = Math.max(
      0,
      Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000)
    );
    return {
      type: days > 0 ? 'trial' : 'expired',
      label: days > 0 ? `Trial · ${days} Days Left` : 'Trial ended',
    };
  }
  return { type: 'trial', label: 'Trial' };
}

const PremiumDashboardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch<AppDispatch>();

  const { user } = useAuth();
  const { isOnline, isSyncing, lastSyncTime } = useSync();
  const { unreadCount } = useNotification();
  const { stats: inventoryStats } = useInventory();
  const { selectedCompany } = useCompany();

  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingLedgerSummary[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionState>({
    type: 'trial',
    label: 'Trial',
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod>('7D');
  const [salesSeries, setSalesSeries] = useState<Partial<Record<SalesPeriod, SalesSeries>>>({});
  const [salesLoading, setSalesLoading] = useState(false);

  const lastLoadAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const billingAtRef = useRef(0);

  const loadDashboard = useCallback(
    async (force = false) => {
      const companyId = selectedCompany?.id;
      if (!companyId) {
        setLoading(false);
        return;
      }
      if (inFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastLoadAtRef.current < MIN_AUTO_RELOAD_MS) return;

      inFlightRef.current = true;
      setLoading(true);

      // Redux-backed counters
      dispatch(fetchInventoryStats(companyId));
      dispatch(fetchUnreadCount());
      dispatch(getSyncStatus());

      const loadBilling =
        force || Date.now() - billingAtRef.current > 5 * 60 * 1000;

      try {
        const [summaryRes, outstandingRes, billingRes] = await Promise.allSettled([
          reportService.getDashboardSummary(companyId),
          reportService.getOutstandingReceivable(companyId),
          loadBilling ? billingService.getStatus() : Promise.resolve(null),
        ]);

        if (summaryRes.status === 'fulfilled' && summaryRes.value?.data) {
          const data = summaryRes.value.data;
          setSummary(data);
          setSalesSeries((prev) => ({ ...prev, '7D': trendToSeries(data.salesTrend) }));
          void offlineCacheService.saveDashboardSummary(companyId, data);
        } else {
          const cached = await offlineCacheService.loadDashboardSummary(companyId);
          if (cached) {
            setSummary(cached);
            setSalesSeries((prev) => ({ ...prev, '7D': trendToSeries(cached.salesTrend) }));
          }
        }

        if (outstandingRes.status === 'fulfilled' && outstandingRes.value?.data) {
          setOutstanding(outstandingRes.value.data.ledgers || []);
        }

        if (billingRes.status === 'fulfilled' && billingRes.value) {
          billingAtRef.current = Date.now();
          setSubscription(buildSubscription(billingRes.value as any));
        }

        lastLoadAtRef.current = Date.now();
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [dispatch, selectedCompany?.id]
  );

  useFocusEffect(
    useCallback(() => {
      loadDashboard(false);
    }, [loadDashboard])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboard(true);
    setRefreshing(false);
  }, [loadDashboard]);

  // Lazy-fetch 30D / 90D sales windows on first selection.
  const handlePeriodChange = useCallback(
    async (period: SalesPeriod) => {
      setSalesPeriod(period);
      const companyId = selectedCompany?.id;
      if (!companyId || period === '7D' || salesSeries[period]) return;

      setSalesLoading(true);
      try {
        const days = period === '30D' ? 30 : 90;
        const res = await reportService.getSalesReport({
          companyId,
          startDate: isoDaysAgo(days),
          endDate: isoDaysAgo(0),
          // 90 daily points is unreadable on a phone-width chart — bucket by week.
          groupBy: period === '90D' ? 'week' : 'day',
        });
        // Rows are { date, amount, count } — the server groups and sorts them.
        const rows = res?.data?.salesByPeriod || [];
        const labels = sampleLabels(
          rows.map((r) => formatDayMonth(r.date)),
          6
        );
        setSalesSeries((prev) => ({
          ...prev,
          [period]: { labels, values: rows.map((r) => r.amount || 0) },
        }));
      } catch {
        setSalesSeries((prev) => ({ ...prev, [period]: EMPTY_SERIES }));
      } finally {
        setSalesLoading(false);
      }
    },
    [selectedCompany?.id, salesSeries]
  );

  // Stack screens (modals, create flows, detail) live on the parent navigator.
  const go = useCallback(
    (route: string, params?: object) => {
      const parent = navigation.getParent?.();
      (parent ?? navigation).navigate(route, params);
    },
    [navigation]
  );

  // Report screens are nested under the Reports tab — mirror the old dashboard.
  const goReport = useCallback(
    // standalone: opened from the dashboard, so Back must return here rather
    // than dropping the user on the reports list they never visited.
    (screen: string) =>
      navigateToReportTab(navigation as any, screen as any, undefined, {
        standalone: true,
      }),
    [navigation]
  );

  const goSales = useCallback(
    () => go('FilteredVouchers', { voucherType: 'sales', title: 'Sales' }),
    [go]
  );

  const goPurchases = useCallback(
    () => go('FilteredVouchers', { voucherType: 'purchase', title: 'Purchase' }),
    [go]
  );

  const kpiPress = useCallback(
    (id: string) => {
      switch (id) {
        case 'revenue':
          return goSales();
        case 'purchase':
          return goPurchases();
        case 'receivables':
          return goReport('OutstandingReceivable');
        case 'payable':
          return goReport('OutstandingPayable');
        case 'bank':
          return goReport('CashBankBook');
        case 'profit':
          return goReport('ProfitLoss');
        default:
          return goReport('VouchersList');
      }
    },
    [goSales, goPurchases, goReport]
  );

  const handleTabPress = useCallback(
    (key: DashboardTab) => {
      if (key === 'dashboard') return;
      navigateToTab(navigation as any, TAB_ROUTE[key]);
    },
    [navigation]
  );

  const handleVoucher = useCallback(() => go('CreateNewVoucher', {}), [go]);

  // ---- Derive view models from live data ----

  const tallyLastSync =
    summary?.lastSyncedAt ||
    (selectedCompany as { tallyIntegration?: { lastSyncDate?: string } } | null)
      ?.tallyIntegration?.lastSyncDate ||
    lastSyncTime;

  const header: HeaderData = {
    greeting: getGreeting(),
    userName: user?.name?.split(' ')[0] || 'there',
    companyName: selectedCompany?.name || 'Select company',
    sync: {
      online: isOnline,
      label: isSyncing
        ? 'Syncing…'
        : isOnline
        ? `Synced ${formatRelativeTime(tallyLastSync)}`
        : 'Offline',
    },
    subscription,
    unreadNotifications: unreadCount || 0,
  };

  /**
   * Six tiles in a 2-column grid; order below is read row-by-row, so the
   * columns come out as:
   *   left  — Revenue, Receivables, Bank Balance
   *   right — Purchase, Payables, Profit This Month
   */
  const kpis: KpiCardData[] = useMemo(() => {
    if (!summary) return [];
    const profit = summary.profitThisMonth || 0;

    // Older backends only carry purchases in the back-compat `thisMonth` block.
    const purchaseAmount =
      summary.monthlyPurchase?.amount ?? summary.thisMonth?.purchases ?? 0;
    const purchaseCount = summary.monthlyPurchase?.count;

    // Payables read a report the agent may not have pushed yet. An unsynced
    // report is not "₹0 payable" — show a dash rather than a figure Tally
    // never confirmed.
    const payable = summary.payable;
    const payableSynced = Boolean(payable?.synced);

    return [
      {
        id: 'revenue',
        label: 'Sales',
        value: formatIndianCompact(summary.monthlyRevenue.amount),
        deltaLabel: `${summary.monthlyRevenue.count} invoices`,
        icon: 'trending-up',
        accent: 'green',
        spark: (summary.salesTrend || []).map((r) => r.amount || 0),
      },
      {
        id: 'purchase',
        label: 'Purchase',
        value: formatIndianCompact(purchaseAmount),
        deltaLabel:
          purchaseCount === undefined ? 'This month' : `${purchaseCount} bills`,
        icon: 'cart-outline',
        accent: 'purple',
      },
      {
        id: 'receivables',
        label: 'Receivables',
        value: formatIndianCompact(summary.outstanding.receivables),
        deltaLabel: `${summary.outstanding.overdueParties} overdue`,
        deltaPositive: false,
        icon: 'account-cash-outline',
        accent: 'orange',
      },
      {
        id: 'payable',
        label: 'Payables',
        value: payableSynced ? formatIndianCompact(payable!.payables) : '—',
        deltaLabel: payableSynced
          ? `${payable!.overdueParties} overdue`
          : 'Awaiting Tally sync',
        deltaPositive: payableSynced ? false : undefined,
        icon: 'account-arrow-up-outline',
        accent: 'red',
      },
      {
        id: 'bank',
        label: 'Bank Balance',
        value: formatIndianCompact(summary.bankBalance.amount),
        // `bankAccounts` is the bank-group *balance*, not a count of accounts —
        // name what the figure is made of instead of miscounting it.
        deltaLabel: 'Bank Account + Cash in Hand',
        icon: 'bank',
        accent: 'purple',
      },
      {
        id: 'profit',
        label: 'Profit This Month',
        value: `${profit < 0 ? '-' : ''}${formatIndianCompact(Math.abs(profit))}`,
        deltaLabel: profit >= 0 ? 'Net profit' : 'Net loss',
        deltaPositive: profit >= 0,
        icon: 'chart-box',
        accent: profit >= 0 ? 'green' : 'red',
      },
    ];
  }, [summary]);

  const topOutstanding: OutstandingItem[] = useMemo(
    () =>
      [...outstanding]
        .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
        .slice(0, 4)
        .map((l, i) => ({
          id: `${l.partyName}-${i}`,
          name: l.partyName,
          amount: formatIndianCompact(l.totalOutstanding),
          status:
            l.oldestOverdueDays && l.oldestOverdueDays > 0 ? 'overdue' : 'dueSoon',
        })),
    [outstanding]
  );

  const activeSeries = salesSeries[salesPeriod] ?? EMPTY_SERIES;
  const salesTotal = activeSeries.values.reduce((s, v) => s + v, 0);

  // ---- Render ----

  if (!selectedCompany?.id) {
    return (
      <View style={styles.root}>
        <HeaderSection
          data={header}
          onCompanyPress={() => go('CompanySelection')}
          onSettingsPress={() => go('Settings')}
        />
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Welcome to TallyFin</Text>
          <Text style={styles.emptyBody}>
            Choose a company linked from Tally to see your business dashboard.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.green}
            colors={[colors.green]}
          />
        }
      >
        <HeaderSection
          data={header}
          onCompanyPress={() => go('CompanySelection')}
          onNotificationsPress={() => go('Notifications')}
          onProfilePress={() => go('Profile')}
          onSettingsPress={() => go('Settings')}
          onSubscriptionPress={() => go('Billing')}
        />

        <View style={styles.content}>
          <View style={styles.heroRow}>
            {/* Display only — no drill-down, since no single report matches this sum. */}
            <HeroCard
              variant="netWorth"
              data={{
                value: formatIndianCompact(
                  (summary?.bankBalance.amount || 0) +
                    (summary?.outstanding.receivables || 0)
                ),
                trendLabel: `${signedCompact(summary?.profitThisMonth || 0)} this month`,
                trendPositive: (summary?.profitThisMonth || 0) >= 0,
                formulaLabel: 'Cash & Bank + Receivables',
              }}
            />
            <View style={styles.heroGap} />
            <HeroCard
              variant="receivables"
              data={{
                value: formatIndianCompact(summary?.outstanding.receivables || 0),
                partiesLabel: `${summary?.outstanding.parties || 0} Parties`,
                progress:
                  summary && summary.outstanding.parties > 0
                    ? summary.outstanding.overdueParties / summary.outstanding.parties
                    : 0,
                ringCenterValue: String(summary?.outstanding.overdueParties || 0),
                ringCenterLabel: 'Overdue',
              }}
              onPress={() => goReport('OutstandingReceivable')}
            />
          </View>

          {loading && !summary ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.green} />
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Business Overview</Text>
              </View>

              <View style={styles.kpiGrid}>
                {kpis.map((kpi) => (
                  <View key={kpi.id} style={styles.kpiCell}>
                    <KpiCard data={kpi} onPress={() => kpiPress(kpi.id)} />
                  </View>
                ))}
              </View>

              <View style={styles.block}>
                <SalesChart
                  value={formatIndianCompact(salesTotal)}
                  activePeriod={salesPeriod}
                  series={activeSeries}
                  loading={salesLoading}
                  onPeriodChange={handlePeriodChange}
                  screenPadding={SCREEN_PADDING}
                />
              </View>

              <View style={styles.block}>
                <OutstandingList
                  items={topOutstanding}
                  onViewAll={() => goReport('OutstandingReceivable')}
                  onItemPress={() => goReport('OutstandingReceivable')}
                />
              </View>

              {/* Low-stock surfaced from inventory stats when present */}
              {inventoryStats?.lowStock ? (
                <Text
                  style={styles.footNote}
                  onPress={() => navigation.navigate('Inventory')}
                >
                  {inventoryStats.lowStock} item(s) low on stock — tap to review.
                </Text>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      <FloatingVoucherButton
        onPress={handleVoucher}
        bottomOffset={insets.bottom + 40}
      />

      <BottomNavigation items={navItems} active="dashboard" onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: SCREEN_PADDING },
  heroRow: {
    flexDirection: 'row',
    marginTop: -(spacing.xxxl + spacing.md),
  },
  heroGap: { width: spacing.sm },
  loadingBlock: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyTitle: {
    fontSize: fontSize.h3,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
  viewAll: { color: colors.green, fontSize: fontSize.label, fontWeight: fontWeight.medium },
  chev: { fontSize: fontSize.bodyLg },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  kpiCell: { width: '50%', padding: spacing.xxs + 2 },
  block: { marginTop: spacing.md },
  footNote: {
    color: colors.textSecondary,
    fontSize: fontSize.label,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});

export default PremiumDashboardScreen;
