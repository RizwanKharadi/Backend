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

import { reportService, DashboardSummaryData } from '../services/reportService';
import { billingService } from '../services/billingService';
import { offlineCacheService } from '../services/offlineCacheService';
import { Voucher } from '../types';
import { MainTabScreenProps } from '../types/navigation';
import { navigateToReportTab } from '../navigation/reportNavigation';
import {
  formatCompactAmount,
  formatCurrency,
  formatWeekday,
  parseLocalDateString,
} from '../utils/formatters';
import { useTranslation } from 'react-i18next';

type Props = MainTabScreenProps<'Dashboard'>;

/**
 * Billing state is held structurally, never as its display string.
 *
 * It used to be a `string | null` that the attention banner then inspected with
 * `=== 'Trial ended'` and `parseInt(label.replace(/\D/g, ''))`. That works only
 * while the label is English — translating it would have silently stopped the
 * "subscription inactive" warning from ever showing.
 */
type TrialState =
  | { kind: 'trial'; days: number }
  | { kind: 'ended' }
  | { kind: 'active' }
  | { kind: 'pastDue' };

const MIN_AUTO_RELOAD_MS = 45_000;

function trendFromSummary(
  rows: Array<{ date: string; amount: number }> | undefined
): { labels: string[]; values: number[] } {
  const labels: string[] = [];
  const values: number[] = [];
  for (const row of rows || []) {
    labels.push(formatWeekday(parseLocalDateString(row.date)));
    values.push(row.amount || 0);
  }
  return { labels, values };
}

const DashboardScreen: React.FC<Props> = ({ navigation }) => {
  const parentNavigation = navigation.getParent();
  const dispatch = useDispatch<AppDispatch>();
  const { t } = useTranslation();

  const { user } = useAuth();
  const { isOnline, isSyncing, lastSyncTime } = useSync();
  const { stats: voucherStats } = useVoucher();
  const { stats: inventoryStats } = useInventory();
  const { unreadCount } = useNotification();
  const { selectedCompany } = useCompany();

  const [refreshing, setRefreshing] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [trialState, setTrialState] = useState<TrialState | null>(null);

  const lastLoadAtRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const billingLoadedAtRef = useRef(0);

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
        const billingPromise = shouldLoadBilling
          ? billingService.getStatus()
          : Promise.resolve(null);

        const [summaryRes, billingRes] = await Promise.allSettled([
          reportService.getDashboardSummary(companyId),
          billingPromise,
        ]);

        if (summaryRes.status === 'fulfilled' && summaryRes.value?.data) {
          const data = summaryRes.value.data;
          setSummary(data);
          void offlineCacheService.saveDashboardSummary(companyId, data);
        } else {
          const cached = await offlineCacheService.loadDashboardSummary(companyId);
          if (cached) {
            setSummary(cached);
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
            setTrialState(
              days > 0 ? { kind: 'trial', days } : { kind: 'ended' }
            );
          } else if (sub?.status === 'active') {
            setTrialState({ kind: 'active' });
          } else if (sub?.status === 'past_due') {
            setTrialState({ kind: 'pastDue' });
          } else {
            setTrialState(null);
          }
        }
      } finally {
        setLoadingExtra(false);
      }
    },
    [selectedCompany?.id]
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

  const todaySales = summary?.todaySales?.amount ?? 0;
  const todayInvoiceCount = summary?.todaySales?.count ?? 0;
  const monthlyRevenue = summary?.monthlyRevenue?.amount ?? 0;
  const monthFromDate = summary?.monthlyRevenue?.fromDate ?? '';
  const receivablesTotal = summary?.outstanding?.receivables ?? 0;
  const overdueParties = summary?.outstanding?.overdueParties ?? 0;
  const bankBalance = summary?.bankBalance?.amount ?? 0;
  const profitThisMonth = summary?.profitThisMonth ?? 0;
  const topCustomerName = summary?.topCustomer?.name ?? null;
  const topCustomerAmount = summary?.topCustomer?.amount ?? 0;

  const recentVouchers = useMemo(
    () => (summary?.recentVouchers || []).slice(0, 5) as unknown as Voucher[],
    [summary?.recentVouchers]
  );

  const salesTrend = useMemo(
    () => trendFromSummary(summary?.salesTrend),
    [summary?.salesTrend]
  );

  // Tally company sync time (from the agent) — not the phone's own offline-sync clock.
  const tallyLastSync =
    summary?.lastSyncedAt ||
    (selectedCompany as { tallyIntegration?: { lastSyncDate?: string } } | null)
      ?.tallyIntegration?.lastSyncDate ||
    lastSyncTime;

  const lowStockCount = inventoryStats?.lowStock ?? 0;

  const trialLabel = useMemo(() => {
    if (!trialState) return null;
    switch (trialState.kind) {
      case 'trial':
        return t('dashboard.trial.daysLeft', { count: trialState.days });
      case 'ended':
        return t('dashboard.trial.ended');
      case 'active':
        return t('dashboard.trial.active');
      case 'pastDue':
        return t('dashboard.trial.paymentDue');
    }
  }, [trialState, t]);

  const goDayBook = useCallback(() => {
    parentNavigation?.navigate('DayBook', {});
  }, [parentNavigation]);

  const goSales = useCallback(() => {
    parentNavigation?.navigate('FilteredVouchers', {
      voucherType: 'sales',
      title: t('reports.sales'),
    });
  }, [parentNavigation, t]);

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
        message: t('dashboard.attention.overdue', { count: overdueParties }),
        icon: 'alert-circle-outline',
        tone: 'warning',
        onPress: goOutstanding,
      });
    }

    if (trialState?.kind === 'ended' || trialState?.kind === 'pastDue') {
      items.push({
        id: 'billing',
        message: t('dashboard.attention.subscriptionInactive'),
        icon: 'credit-card-outline',
        tone: 'error',
        onPress: () => parentNavigation?.navigate('Billing'),
      });
    } else if (trialState?.kind === 'trial' && trialState.days <= 3) {
      items.push({
        id: 'trial',
        message: t('dashboard.attention.trialEnding', { label: trialLabel }),
        icon: 'clock-alert-outline',
        tone: 'warning',
        onPress: () => parentNavigation?.navigate('Billing'),
      });
    }

    if (!selectedCompany?.id) {
      items.unshift({
        id: 'company',
        message: t('dashboard.attention.selectCompany'),
        icon: 'office-building-outline',
        tone: 'info',
        onPress: () => parentNavigation?.navigate('CompanySelection'),
      });
    }

    return items;
  }, [
    overdueParties,
    trialState,
    trialLabel,
    t,
    selectedCompany?.id,
    parentNavigation,
    goOutstanding,
  ]);

  if (!selectedCompany?.id) {
    return (
      <View style={styles.container}>
        <DashboardHeader
          userName={user?.name}
          companyName={t('dashboard.selectCompany')}
          isOnline={isOnline}
          isSyncing={isSyncing}
          lastSyncTime={tallyLastSync}
          onCompanyPress={() => parentNavigation?.navigate('CompanySelection')}
          onSettingsPress={() => parentNavigation?.navigate('Settings')}
        />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('dashboard.welcomeTitle')}</Text>
          <Text style={styles.emptyBody}>{t('dashboard.welcomeBody')}</Text>
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
        lastSyncTime={tallyLastSync}
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
            <Text style={styles.offlineText}>{t('dashboard.offlineNotice')}</Text>
          </View>
        ) : null}

        {attentionItems.length > 0 ? (
          <AttentionBanner items={attentionItems} />
        ) : null}

        <Text style={styles.sectionLabel}>{t('dashboard.sectionToday')}</Text>

        <DashboardMetricCard
          variant="hero"
          title={t('dashboard.todaySales')}
          value={formatCompactAmount(todaySales)}
          subtitle={t('dashboard.invoicesToday', { count: todayInvoiceCount })}
          icon="cash-register"
          accentColor={metricAccentColors.todaySales}
          onPress={goDayBook}
          loading={loadingExtra}
        />

        <Text style={styles.sectionLabel}>{t('dashboard.sectionOverview')}</Text>

        <View style={styles.gridRow}>
          <DashboardMetricCard
            title={t('dashboard.monthlyRevenue')}
            value={formatCompactAmount(monthlyRevenue)}
            subtitle={
              monthFromDate
                ? t('dashboard.monthRange', { from: monthFromDate })
                : t('dashboard.monthToDate')
            }
            icon="chart-timeline-variant"
            accentColor={metricAccentColors.monthlyRevenue}
            onPress={goSales}
            loading={loadingExtra}
          />
          <View style={styles.gridGap} />
          <DashboardMetricCard
            title={t('dashboard.outstanding')}
            value={formatCompactAmount(receivablesTotal)}
            subtitle={
              overdueParties > 0
                ? t('dashboard.overdueCount', { count: overdueParties })
                : t('dashboard.receivablesDue')
            }
            icon="account-cash-outline"
            accentColor={metricAccentColors.outstanding}
            onPress={goOutstanding}
            loading={loadingExtra}
            badge={
              overdueParties > 0
                ? t('dashboard.dueBadge', { count: overdueParties })
                : undefined
            }
            badgeTone="warning"
          />
        </View>

        <View style={styles.gridRow}>
          <DashboardMetricCard
            title={t('dashboard.bankBalance')}
            value={formatCompactAmount(bankBalance)}
            subtitle={t('dashboard.bankSubtitle')}
            icon="bank"
            accentColor={metricAccentColors.bankBalance}
            onPress={goCashBankBook}
            loading={loadingExtra}
          />
          <View style={styles.gridGap} />
          <DashboardMetricCard
            title={t('dashboard.profitThisMonth')}
            value={formatCompactAmount(profitThisMonth)}
            subtitle={
              profitThisMonth >= 0
                ? t('dashboard.netProfit')
                : t('dashboard.netLoss')
            }
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
            title={t('dashboard.topCustomer')}
            value={topCustomerName || t('common.none')}
            subtitle={
              topCustomerName
                ? formatCurrency(topCustomerAmount)
                : t('dashboard.noCustomerData')
            }
            icon="account-star"
            accentColor={metricAccentColors.topCustomer}
            onPress={goTopCustomers}
            loading={loadingExtra}
          />
          <View style={styles.gridGap} />
          <DashboardMetricCard
            variant="wide"
            title={t('dashboard.lowStockAlerts')}
            value={String(lowStockCount)}
            subtitle={
              lowStockCount > 0
                ? t('dashboard.lowStockNeedAttention', { count: lowStockCount })
                : t('dashboard.stockLevelsOk')
            }
            icon="package-variant-closed"
            accentColor={metricAccentColors.lowStock}
            onPress={goInventory}
            loading={loadingExtra && inventoryStats === undefined}
            badge={lowStockCount > 0 ? t('dashboard.alertBadge') : undefined}
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
