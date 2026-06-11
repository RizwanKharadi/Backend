import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useDispatch } from 'react-redux';
import { useFocusEffect } from '@react-navigation/native';

import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardMetricCard from '../components/dashboard/DashboardMetricCard';
import DashboardSalesTrend from '../components/dashboard/DashboardSalesTrend';
import DashboardRecentActivities from '../components/dashboard/DashboardRecentActivities';
import CreateVoucherFab from '../components/dashboard/CreateVoucherFab';
import GuideTarget from '../components/guide/GuideTarget';
import AttentionBanner, { AttentionItem } from '../components/dashboard/AttentionBanner';
import { dashboardColors, metricAccentColors } from '../components/dashboard/dashboardTheme';

import { AppDispatch } from '../store';
import {
  useAuth,
  useSync,
  useVoucher,
  useInventory,
  useNotification,
  useCompany,
} from '../store/hooks';
import { getSyncStatus } from '../store/slices/syncSlice';
import { fetchVoucherStats } from '../store/slices/voucherSlice';
import { fetchInventoryStats } from '../store/slices/inventorySlice';
import { fetchUnreadCount } from '../store/slices/notificationSlice';

import { reportService } from '../services/reportService';
import { voucherService } from '../services/voucherService';
import { billingService } from '../services/billingService';
import { offlineCacheService } from '../services/offlineCacheService';
import { Voucher } from '../types';
import { MainTabScreenProps } from '../types/navigation';
import { navigateToReportTab } from '../navigation/reportNavigation';
import { formatIndianCompact, formatCurrency, toLocalDateString } from '../utils/formatters';
import {
  isSalesVoucher,
  getVoucherTotalAmount,
  monthSalesRevenue,
  monthStartToToday,
  topCustomerFromVouchers,
} from '../utils/voucherHelpers';

type Props = MainTabScreenProps<'Dashboard'>;

const MIN_AUTO_RELOAD_MS = 45_000;
const TREND_DAYS = 7;

function sumByTypes(vouchers: Voucher[], types: string[]): number {
  const normalized = types.map((t) => t.toLowerCase());
  let amount = 0;
  for (const v of vouchers) {
    const t = (v.voucherType || '').toLowerCase();
    if (normalized.some((n) => t.includes(n))) {
      amount += getVoucherTotalAmount(v);
    }
  }
  return amount;
}

function extractBankBalance(data: {
  assets?: { current?: Array<{ account: string; amount: number }> };
  groups?: Array<{ name: string; amount: number; section?: string }>;
} | null): number {
  if (!data) return 0;
  const current = data.assets?.current || [];
  const fromAccounts = current
    .filter((a) => /bank|cash|current account|savings/i.test(a.account || ''))
    .reduce((s, a) => s + (a.amount || 0), 0);
  if (fromAccounts > 0) return fromAccounts;

  const groups = data.groups || [];
  const bankGroup = groups.find(
    (g) =>
      g.section === 'assets' &&
      /bank|cash/i.test(g.name || '')
  );
  return bankGroup?.amount ?? 0;
}

function buildSalesTrend(vouchers: Voucher[]): { labels: string[]; values: number[] } {
  const labels: string[] = [];
  const values: number[] = [];

  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = toLocalDateString(d);
    labels.push(
      d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)
    );
    const dayTotal = vouchers
      .filter((v) => (v.date || v.createdAt || '').slice(0, 10) === iso)
      .filter((v) => /sales|invoice/i.test((v.voucherType || '').toLowerCase()))
      .reduce((s, v) => s + getVoucherTotalAmount(v), 0);
    values.push(dayTotal);
  }

  return { labels, values };
}

const DashboardScreen: React.FC<Props> = ({ navigation }) => {
  const parentNavigation = navigation.getParent();
  const dispatch = useDispatch<AppDispatch>();

  const { user } = useAuth();
  const { isOnline, isSyncing, lastSyncTime } = useSync();
  const { stats: voucherStats } = useVoucher();
  const { stats: inventoryStats } = useInventory();
  const { unreadCount } = useNotification();
  const { selectedCompany } = useCompany();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [recentVouchers, setRecentVouchers] = useState<Voucher[]>([]);
  const [trendVouchers, setTrendVouchers] = useState<Voucher[]>([]);
  const [todayVouchers, setTodayVouchers] = useState<Voucher[]>([]);
  const [receivablesTotal, setReceivablesTotal] = useState(0);
  const [overdueParties, setOverdueParties] = useState(0);
  const [bankBalance, setBankBalance] = useState(0);
  const [profitThisMonth, setProfitThisMonth] = useState(0);
  const [topCustomerName, setTopCustomerName] = useState<string | null>(null);
  const [topCustomerAmount, setTopCustomerAmount] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [trialLabel, setTrialLabel] = useState<string | null>(null);

  const lastLoadAtRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const billingLoadedAtRef = useRef(0);

  const todayIso = useMemo(() => toLocalDateString(new Date()), []);

  const loadCoreStats = useCallback(() => {
    if (!selectedCompany?.id) return;
    dispatch(fetchVoucherStats(selectedCompany.id));
    dispatch(fetchInventoryStats(selectedCompany.id));
    dispatch(fetchUnreadCount());
    dispatch(getSyncStatus());
  }, [dispatch, selectedCompany?.id]);

  const loadExtraData = useCallback(
    async (options?: { forceBilling?: boolean }) => {
      if (!selectedCompany?.id) {
        setLoadingExtra(false);
        return;
      }

      setLoadingExtra(true);
      const companyId = selectedCompany.id;
      const shouldLoadBilling =
        options?.forceBilling ||
        Date.now() - billingLoadedAtRef.current > 5 * 60 * 1000;

      try {
        const { fromDate, toDate, startDateIso, endDateIso } = monthStartToToday();

        const recentPromise = voucherService.getVouchers({
          companyId,
          limit: 200,
          page: 1,
        });
        const monthSalesPromise = voucherService.getVouchers({
          companyId,
          fromDate,
          toDate,
          limit: 500,
          page: 1,
        });
        const outstandingPromise = reportService.getOutstandingReceivable(companyId);
        const profitPromise = reportService.getProfitLossReport({
          companyId,
          periodKey: 'this_month',
        });
        const topTenPromise = reportService.getTop10Report({
          companyId,
          startDate: startDateIso,
          endDate: endDateIso,
        });
        const balancePromise = reportService.getBalanceSheetReport({
          companyId,
          periodKey: 'this_month',
        });
        const billingPromise = shouldLoadBilling
          ? billingService.getStatus()
          : Promise.resolve(null);

        const [
          recentRes,
          monthSalesRes,
          outstandingRes,
          profitRes,
          topTenRes,
          balanceRes,
          billingRes,
        ] = await Promise.allSettled([
          recentPromise,
          monthSalesPromise,
          outstandingPromise,
          profitPromise,
          topTenPromise,
          balancePromise,
          billingPromise,
        ]);

        let recvTotal = 0;
        let overdue = 0;
        let bank = 0;
        let profit = 0;
        let topName: string | null = null;
        let topAmt = 0;
        let monthSalesTotal = 0;
        let recentSlice: Voucher[] = [];
        let todaySlice: Voucher[] = [];
        let trendSlice: Voucher[] = [];

        let monthSalesList: Voucher[] = [];
        if (monthSalesRes.status === 'fulfilled') {
          monthSalesList = (monthSalesRes.value.data || []).filter(isSalesVoucher);
          monthSalesTotal = monthSalesRevenue(monthSalesList, fromDate, toDate);
        }

        if (recentRes.status === 'fulfilled') {
          const all = recentRes.value.data || [];
          recentSlice = all.slice(0, 5);
          todaySlice = all.filter(
            (v) => (v.date || v.createdAt || '').slice(0, 10) === todayIso
          );
          trendSlice = all;
          setRecentVouchers(recentSlice);
          setTodayVouchers(todaySlice);
          setTrendVouchers(trendSlice);

          if (monthSalesTotal === 0) {
            monthSalesTotal = monthSalesRevenue(all, fromDate, toDate);
            if (monthSalesList.length === 0) {
              monthSalesList = all.filter(isSalesVoucher);
            }
          }
        }

        setMonthlyRevenue(monthSalesTotal);

        if (outstandingRes.status === 'fulfilled') {
          const data = outstandingRes.value.data;
          recvTotal = data?.totalOutstanding || 0;
          const ledgers = data?.ledgers || [];
          overdue = ledgers.filter((l) => (l.oldestOverdueDays || 0) > 0).length;
          setReceivablesTotal(recvTotal);
          setOverdueParties(overdue);
        }

        if (profitRes.status === 'fulfilled') {
          profit = profitRes.value.data?.summary?.netProfit ?? 0;
          setProfitThisMonth(profit);
        }

        if (topTenRes.status === 'fulfilled') {
          const top = topTenRes.value.data?.topCustomers?.[0];
          topName = top?.name?.trim() || null;
          topAmt = top?.totalAmount ?? 0;
        }

        if (!topName && monthSalesList.length > 0) {
          const fallback = topCustomerFromVouchers(monthSalesList);
          if (fallback) {
            topName = fallback.name;
            topAmt = fallback.amount;
          }
        }

        if (!topName && recentRes.status === 'fulfilled') {
          const fallback = topCustomerFromVouchers(recentRes.value.data || []);
          if (fallback) {
            topName = fallback.name;
            topAmt = fallback.amount;
          }
        }

        setTopCustomerName(topName);
        setTopCustomerAmount(topAmt);

        if (balanceRes.status === 'fulfilled') {
          bank = extractBankBalance(balanceRes.value.data);
          setBankBalance(bank);
        }

        if (recentRes.status === 'fulfilled') {
          void offlineCacheService.saveDashboardExtras(companyId, {
            recentVouchers: recentSlice,
            todayVouchers: todaySlice,
            trendVouchers: trendSlice,
            receivablesTotal: recvTotal,
            receivableParties: outstandingRes.status === 'fulfilled'
              ? (outstandingRes.value.data?.ledgers?.length ?? 0)
              : 0,
            overdueParties: overdue,
            bankBalance: bank,
            profitThisMonth: profit,
            topCustomerName: topName,
            topCustomerAmount: topAmt,
            monthlyRevenue: monthSalesTotal,
            cachedAt: new Date().toISOString(),
          });
        } else if (recentRes.status === 'rejected') {
          const cached = await offlineCacheService.loadDashboardExtras(companyId);
          if (cached) {
            setRecentVouchers(cached.recentVouchers.slice(0, 5));
            setTodayVouchers(cached.todayVouchers);
            setTrendVouchers(cached.trendVouchers || []);
            setReceivablesTotal(cached.receivablesTotal);
            setOverdueParties(cached.overdueParties);
            setBankBalance(cached.bankBalance ?? 0);
            setProfitThisMonth(cached.profitThisMonth ?? 0);
            setTopCustomerName(cached.topCustomerName ?? null);
            setTopCustomerAmount(cached.topCustomerAmount ?? 0);
            setMonthlyRevenue(cached.monthlyRevenue ?? 0);
          }
        }

        if (billingRes.status === 'fulfilled' && billingRes.value) {
          billingLoadedAtRef.current = Date.now();
          const sub = billingRes.value?.subscription as {
            status?: string;
            trialEndsAt?: string;
          } | undefined;
          if (sub?.status === 'trial' && sub.trialEndsAt) {
            const days = Math.max(
              0,
              Math.ceil(
                (new Date(sub.trialEndsAt).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24)
              )
            );
            setTrialLabel(days > 0 ? `Trial · ${days}d left` : 'Trial ended');
          } else if (sub?.status === 'active') {
            setTrialLabel('Active plan');
          } else if (sub?.status === 'past_due') {
            setTrialLabel('Payment due');
          } else {
            setTrialLabel(null);
          }
        }
      } finally {
        setLoadingExtra(false);
      }
    },
    [selectedCompany?.id, todayIso]
  );

  const loadDashboard = useCallback(
    async (force = false) => {
      if (!selectedCompany?.id) return;
      if (loadInFlightRef.current) return;

      const now = Date.now();
      if (!force && now - lastLoadAtRef.current < MIN_AUTO_RELOAD_MS) {
        return;
      }

      loadInFlightRef.current = true;
      try {
        loadCoreStats();
        await loadExtraData({ forceBilling: force });
        lastLoadAtRef.current = Date.now();
      } finally {
        loadInFlightRef.current = false;
      }
    },
    [selectedCompany?.id, loadCoreStats, loadExtraData]
  );

  useFocusEffect(
    useCallback(() => {
      loadDashboard(false);
    }, [loadDashboard])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard(true);
    setRefreshing(false);
  };

  const todaySales = useMemo(
    () => sumByTypes(todayVouchers, ['sales', 'invoice']),
    [todayVouchers]
  );

  const salesTrend = useMemo(
    () => buildSalesTrend(trendVouchers),
    [trendVouchers]
  );

  const lowStockCount = inventoryStats?.lowStock ?? 0;

  const goDayBook = useCallback(() => {
    parentNavigation?.navigate('DayBook', {});
  }, [parentNavigation]);

  const goSales = useCallback(() => {
    parentNavigation?.navigate('FilteredVouchers', {
      voucherType: 'sales',
      title: 'Sales',
    });
  }, [parentNavigation]);

  const goOutstanding = useCallback(() => {
    navigateToReportTab(navigation, 'OutstandingReceivable');
  }, [navigation]);

  const goCashBankBook = useCallback(() => {
    navigateToReportTab(navigation, 'CashBankBook');
  }, [navigation]);

  const goProfitLoss = useCallback(() => {
    navigateToReportTab(navigation, 'ProfitLoss');
  }, [navigation]);

  const goTopCustomers = useCallback(() => {
    navigateToReportTab(navigation, 'TopTenReport');
  }, [navigation]);

  const goInventory = useCallback(() => {
    navigation.navigate('Inventory');
  }, [navigation]);

  const goSync = useCallback(() => {
    parentNavigation?.navigate('Sync');
  }, [parentNavigation]);

  const goAllActivities = useCallback(() => {
    navigateToReportTab(navigation, 'VouchersList');
  }, [navigation]);

  const attentionItems: AttentionItem[] = useMemo(() => {
    const items: AttentionItem[] = [];

    if (overdueParties > 0) {
      items.push({
        id: 'overdue',
        message: `${overdueParties} ${overdueParties === 1 ? 'party has' : 'parties have'} overdue receivables`,
        icon: 'alert-circle-outline',
        tone: 'warning',
        onPress: goOutstanding,
      });
    }

    if (trialLabel === 'Trial ended' || trialLabel === 'Payment due') {
      items.push({
        id: 'billing',
        message: 'Subscription inactive — renew to keep syncing',
        icon: 'credit-card-outline',
        tone: 'error',
        onPress: () => parentNavigation?.navigate('Billing'),
      });
    } else if (trialLabel?.startsWith('Trial ·')) {
      const days = parseInt(trialLabel.replace(/\D/g, ''), 10);
      if (days <= 3) {
        items.push({
          id: 'trial',
          message: `${trialLabel} — subscribe to continue after trial`,
          icon: 'clock-alert-outline',
          tone: 'warning',
          onPress: () => parentNavigation?.navigate('Billing'),
        });
      }
    }

    if (!selectedCompany?.id) {
      items.unshift({
        id: 'company',
        message: 'Select a company to view your business dashboard',
        icon: 'office-building-outline',
        tone: 'info',
        onPress: () => parentNavigation?.navigate('CompanySelection'),
      });
    }

    return items;
  }, [
    overdueParties,
    trialLabel,
    selectedCompany?.id,
    parentNavigation,
    goOutstanding,
  ]);

  if (!selectedCompany?.id) {
    return (
      <View style={styles.container}>
        <DashboardHeader
          userName={user?.name}
          companyName="Select company"
          isOnline={isOnline}
          isSyncing={isSyncing}
          lastSyncTime={lastSyncTime}
          onCompanyPress={() => parentNavigation?.navigate('CompanySelection')}
          onSettingsPress={() => parentNavigation?.navigate('Settings')}
        />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Welcome to FinSync360</Text>
          <Text style={styles.emptyBody}>
            Choose a company linked from Tally to see your financial dashboard.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DashboardHeader
        userName={user?.name}
        companyName={selectedCompany.name}
        isOnline={isOnline}
        isSyncing={isSyncing}
        lastSyncTime={lastSyncTime}
        trialLabel={trialLabel}
        unreadNotifications={unreadCount || 0}
        onCompanyPress={() => parentNavigation?.navigate('CompanySelection')}
        onSettingsPress={() => parentNavigation?.navigate('Settings')}
        onProfilePress={() => parentNavigation?.navigate('Profile')}
        onNotificationsPress={() => parentNavigation?.navigate('Notifications')}
        onSyncPress={goSync}
        onTrialPress={() => parentNavigation?.navigate('Billing')}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={dashboardColors.accent}
            colors={[dashboardColors.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!isOnline ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              You&apos;re offline — showing last synced data
            </Text>
          </View>
        ) : null}

        {attentionItems.length > 0 ? (
          <AttentionBanner items={attentionItems} />
        ) : null}

        <Text style={styles.sectionLabel}>Today at a glance</Text>

        <DashboardMetricCard
          variant="hero"
          title="Today's sales"
          value={formatIndianCompact(todaySales)}
          subtitle={`${todayVouchers.filter((v) =>
            /sales|invoice/i.test((v.voucherType || '').toLowerCase())
          ).length} invoice(s) today`}
          icon="cash-register"
          accentColor={metricAccentColors.todaySales}
          onPress={goDayBook}
          loading={loadingExtra}
        />

        <Text style={styles.sectionLabel}>Business overview</Text>

        <View style={styles.gridRow}>
          <DashboardMetricCard
            title="Monthly revenue"
            value={formatIndianCompact(monthlyRevenue)}
            subtitle={`${monthStartToToday().fromDate} to today`}
            icon="chart-timeline-variant"
            accentColor={metricAccentColors.monthlyRevenue}
            onPress={goSales}
            loading={loadingExtra}
          />
          <View style={styles.gridGap} />
          <DashboardMetricCard
            title="Outstanding"
            value={formatIndianCompact(receivablesTotal)}
            subtitle={
              overdueParties > 0
                ? `${overdueParties} overdue`
                : 'Receivables due'
            }
            icon="account-cash-outline"
            accentColor={metricAccentColors.outstanding}
            onPress={goOutstanding}
            loading={loadingExtra}
            badge={overdueParties > 0 ? `${overdueParties} due` : undefined}
            badgeTone="warning"
          />
        </View>

        <View style={styles.gridRow}>
          <DashboardMetricCard
            title="Bank balance"
            value={formatIndianCompact(bankBalance)}
            subtitle="Cash & bank accounts"
            icon="bank"
            accentColor={metricAccentColors.bankBalance}
            onPress={goCashBankBook}
            loading={loadingExtra}
          />
          <View style={styles.gridGap} />
          <DashboardMetricCard
            title="Profit this month"
            value={formatIndianCompact(profitThisMonth)}
            subtitle={profitThisMonth >= 0 ? 'Net profit' : 'Net loss'}
            icon="finance"
            accentColor={
              profitThisMonth >= 0
                ? metricAccentColors.profit
                : dashboardColors.negative
            }
            onPress={goProfitLoss}
            loading={loadingExtra}
          />
        </View>

        <View style={styles.gridRow}>
          <DashboardMetricCard
            variant="wide"
            title="Top customer"
            value={topCustomerName || '—'}
            subtitle={
              topCustomerName
                ? formatCurrency(topCustomerAmount)
                : 'No customer data yet'
            }
            icon="account-star"
            accentColor={metricAccentColors.topCustomer}
            onPress={goTopCustomers}
            loading={loadingExtra}
          />
          <View style={styles.gridGap} />
          <DashboardMetricCard
            variant="wide"
            title="Low stock alerts"
            value={String(lowStockCount)}
            subtitle={
              lowStockCount > 0
                ? `${lowStockCount} item(s) need attention`
                : 'All stock levels OK'
            }
            icon="package-variant-closed"
            accentColor={metricAccentColors.lowStock}
            onPress={goInventory}
            loading={loadingExtra && inventoryStats === undefined}
            badge={lowStockCount > 0 ? 'Alert' : undefined}
            badgeTone="error"
          />
        </View>

        <DashboardSalesTrend
          labels={salesTrend.labels}
          values={salesTrend.values}
          loading={loadingExtra}
        />

        <DashboardRecentActivities
          vouchers={recentVouchers}
          loading={loadingExtra}
          onActivityPress={(id) =>
            parentNavigation?.navigate('VoucherDetail', { voucherId: id })
          }
          onSeeAllPress={goAllActivities}
        />

        <View style={styles.bottomSpacingFab} />
      </ScrollView>

      <GuideTarget targetId="create-voucher">
        <CreateVoucherFab
          onPress={() => parentNavigation?.navigate('CreateNewVoucher')}
        />
      </GuideTarget>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },
  gridRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  gridGap: {
    width: 12,
  },
  offlineBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  offlineText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#92400e',
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 15,
    color: dashboardColors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomSpacingFab: {
    height: 88,
  },
});

export default DashboardScreen;
