/**
 * PremiumReportsScreen — TallyFin Reports as a Business Intelligence hub.
 *
 * Fixed category filter (All / Financial / Inventory / Customer, no scroll),
 * a live Business Snapshot (revenue / receivables / bank / inventory value),
 * then 2-column report grids. Report cards open the existing report screens;
 * reports without a screen yet show a "Soon" badge.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';

import TransactionHeader from '../components/TransactionHeader';
import InventoryStatCard from '../components/InventoryStatCard';
import SectionHeader from '../components/SectionHeader';
import ReportCard from '../components/ReportCard';
import FloatingVoucherButton from '../components/FloatingVoucherButton';
import BottomNavigation from '../components/BottomNavigation';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { navItems, voucherOptions } from '../data/dashboardMockData';
import { DashboardTab, VoucherKey } from '../types/dashboard';

import { AppDispatch } from '../store';
import { useCompany, useInventory, useNotification } from '../store/hooks';
import { fetchInventoryStats } from '../store/slices/inventorySlice';
import { reportService, DashboardSummaryData } from '../services/reportService';
import { formatIndianCompact, toLocalDateString } from '../utils/formatters';

const SCREEN_PADDING = spacing.md;
const MIN_RELOAD_MS = 45_000;

type Category = 'all' | 'financial' | 'inventory' | 'customer';

const CATEGORIES: { key: Category; label: string; icon: string }[] = [
  { key: 'all', label: 'All Reports', icon: 'view-grid-outline' },
  { key: 'financial', label: 'Financial', icon: 'chart-line' },
  { key: 'inventory', label: 'Inventory', icon: 'package-variant-closed' },
  { key: 'customer', label: 'Customer', icon: 'account-group-outline' },
];

const TAB_ROUTE: Record<Exclude<DashboardTab, 'reports'>, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  inventory: 'Inventory',
};

const VOUCHER_INITIAL_TYPE: Record<VoucherKey, string> = {
  sales: 'sales',
  receipt: 'receipt',
  payment: 'payment',
  purchase: 'purchase',
  contra: 'contra',
  journal: 'journal',
  debitNote: 'debit_note',
  creditNote: 'credit_note',
};

interface ReportDef {
  icon: string;
  color: string;
  title: string;
  description: string;
  badge?: string;
  soon?: boolean;
  route?: string;
  params?: object;
}

const PremiumReportsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch<AppDispatch>();

  const { selectedCompany } = useCompany();
  const { stats: inventoryStats } = useInventory();
  const { unreadCount } = useNotification();

  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCat, setActiveCat] = useState<Category>('all');

  const lastLoadRef = useRef(0);
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (force: boolean) => {
      const companyId = selectedCompany?.id;
      if (!companyId) return;
      const now = Date.now();
      if (!force && now - lastLoadRef.current < MIN_RELOAD_MS) return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      dispatch(fetchInventoryStats(companyId));
      try {
        const res = await reportService.getDashboardSummary(companyId);
        if (res?.data) setSummary(res.data);
        lastLoadRef.current = Date.now();
      } catch {
        // snapshot is best-effort; report cards still work
      } finally {
        inFlightRef.current = false;
      }
    },
    [dispatch, selectedCompany?.id]
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const go = useCallback(
    (route: string, params?: object) => navigation.navigate(route, params),
    [navigation]
  );

  const openReport = useCallback(
    (def: ReportDef) => {
      if (def.soon || !def.route) {
        Toast.show({ type: 'info', text1: `${def.title} coming soon`, visibilityTime: 1800 });
        return;
      }
      go(def.route, def.params);
    },
    [go]
  );

  const handleTabPress = useCallback(
    (key: DashboardTab) => {
      if (key === 'reports') return;
      navigation.navigate(TAB_ROUTE[key as Exclude<DashboardTab, 'reports'>]);
    },
    [navigation]
  );

  const handleVoucher = useCallback(
    (key: VoucherKey) => go('CreateNewVoucher', { initialType: VOUCHER_INITIAL_TYPE[key] }),
    [go]
  );

  // ---- Live Business Snapshot ----
  const snapshot = useMemo(
    () => [
      {
        icon: 'trending-up',
        color: colors.kpiGreen,
        value: formatIndianCompact(summary?.monthlyRevenue.amount || 0),
        label: 'Revenue',
        subtitle: 'This month',
        onPress: () => go('FilteredVouchers', { voucherType: 'sales', title: 'Sales' }),
      },
      {
        icon: 'account-cash-outline',
        color: colors.kpiOrange,
        value: formatIndianCompact(summary?.outstanding.receivables || 0),
        label: 'Receivables',
        subtitle: `${summary?.outstanding.parties || 0} parties`,
        onPress: () => go('OutstandingReceivable'),
      },
      {
        icon: 'bank',
        color: colors.info,
        value: formatIndianCompact(summary?.bankBalance.amount || 0),
        label: 'Bank Balance',
        subtitle: 'Cash & bank',
        onPress: () => go('CashBankBook'),
      },
      {
        icon: 'cube-outline',
        color: colors.kpiPurple,
        value: formatIndianCompact(inventoryStats.totalValue || 0),
        label: 'Inventory Value',
        subtitle: `${inventoryStats.total || 0} items`,
        onPress: () => go('Inventory'),
      },
    ],
    [summary, inventoryStats, go]
  );

  // ---- Report catalogue ----
  const financial: ReportDef[] = [
    { icon: 'chart-line', color: colors.info, title: 'Profit & Loss', description: 'Income statement and profitability', badge: 'Most used', route: 'ProfitLoss' },
    { icon: 'bank', color: colors.info, title: 'Balance Sheet', description: 'Assets, liabilities and equity', route: 'BalanceSheet' },
    { icon: 'cash-multiple', color: colors.info, title: 'Cash / Bank Book', description: 'Cash-in-hand, bank accounts and OD balances', route: 'CashBankBook' },
    { icon: 'account-cash-outline', color: colors.info, title: 'Receivables', description: 'Bills receivable by ledger', route: 'OutstandingReceivable' },
    { icon: 'account-arrow-up-outline', color: colors.info, title: 'Payables', description: 'Bills payable by ledger', soon: true },
    { icon: 'book-open-variant', color: colors.info, title: 'Day Book', description: 'All vouchers by date range', route: 'DayBook', params: {} },
  ];

  const inventory: ReportDef[] = [
    { icon: 'cube-outline', color: colors.green, title: 'Inventory Valuation', description: 'Stock value and quantity on hand', route: 'InventoryList' },
    { icon: 'swap-horizontal', color: colors.green, title: 'Stock Movement', description: 'Inventory transfers and adjustments', soon: true },
    { icon: 'timer-sand-empty', color: colors.green, title: 'Inactive Items', description: 'Stock items not sold for 30+ days', route: 'InactiveItem' },
    { icon: 'alert-outline', color: colors.green, title: 'Low Stock Report', description: 'Items below reorder level', route: 'InventoryList' },
    { icon: 'close-circle-outline', color: colors.green, title: 'Out of Stock', description: 'Items with zero stock', route: 'InventoryList' },
    { icon: 'trending-up', color: colors.green, title: 'Fast Moving Items', description: 'Best-selling stock items', route: 'FastMovingItems' },
  ];

  const customer: ReportDef[] = [
    { icon: 'trophy-outline', color: colors.kpiPurple, title: 'Top 10 Report', description: 'Top customers, suppliers and items', route: 'TopTenReport' },
    { icon: 'account-cash-outline', color: colors.kpiPurple, title: 'Outstanding Receivable', description: 'Bills receivable by ledger', route: 'OutstandingReceivable' },
    { icon: 'account-clock-outline', color: colors.kpiPurple, title: 'Inactive Customers', description: 'Customers with no bill for 30+ days', route: 'InactiveCustomer' },
    { icon: 'chart-bar', color: colors.kpiPurple, title: 'Sales Analysis', description: 'Sales by period and party', route: 'FilteredVouchers', params: { voucherType: 'sales', title: 'Sales' } },
  ];

  const renderGrid = (defs: ReportDef[]) => {
    const rows: ReportDef[][] = [];
    for (let i = 0; i < defs.length; i += 2) rows.push(defs.slice(i, i + 2));
    return rows.map((row, idx) => (
      <View key={idx} style={styles.gridRow}>
        {row.map((d) => (
          <ReportCard
            key={d.title}
            icon={d.icon}
            color={d.color}
            title={d.title}
            description={d.description}
            badge={d.badge}
            soon={d.soon}
            onPress={() => openReport(d)}
          />
        ))}
        {row.length === 1 ? <View style={styles.gridSpacer} /> : null}
      </View>
    ));
  };

  const showFinancial = activeCat === 'all' || activeCat === 'financial';
  const showInventory = activeCat === 'all' || activeCat === 'inventory';
  const showCustomer = activeCat === 'all' || activeCat === 'customer';

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
        <TransactionHeader
          title="Reports"
          companyName={selectedCompany?.name || 'Select company'}
          dateLabel={`As of ${toLocalDateString(new Date())}`}
          unreadCount={unreadCount || 0}
          onCompanyPress={() => go('CompanySelection')}
          onNotificationsPress={() => go('Notifications')}
          onProfilePress={() => go('Profile')}
          onSettingsPress={() => go('Settings')}
        />

        <View style={styles.content}>
          {/* Fixed category filter (wraps to 2 rows, no scroll) */}
          <View style={styles.filterWrap}>
            {CATEGORIES.map((c) => {
              const active = c.key === activeCat;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.85}
                  onPress={() => setActiveCat(c.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Icon
                    name={c.icon}
                    size={15}
                    color={active ? colors.white : colors.textSecondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Live business snapshot */}
          <View style={styles.snapHeader}>
            <SectionHeader title="Business Snapshot" icon="finance" accentColor={colors.navy} />
          </View>
          <View style={styles.grid}>
            {snapshot.map((s) => (
              <View key={s.label} style={styles.gridCell}>
                <InventoryStatCard
                  compact
                  icon={s.icon}
                  color={s.color}
                  value={s.value}
                  label={s.label}
                  subtitle={s.subtitle}
                  onPress={s.onPress}
                />
              </View>
            ))}
          </View>

          {showFinancial ? (
            <>
              <View style={styles.sectionGap} />
              <SectionHeader title="Financial Reports" icon="chart-line" accentColor={colors.info} />
              {renderGrid(financial)}
            </>
          ) : null}

          {showInventory ? (
            <>
              <View style={styles.sectionGap} />
              <SectionHeader title="Inventory Reports" icon="package-variant-closed" accentColor={colors.green} />
              {renderGrid(inventory)}
            </>
          ) : null}

          {showCustomer ? (
            <>
              <View style={styles.sectionGap} />
              <SectionHeader title="Customer Reports" icon="account-group-outline" accentColor={colors.kpiPurple} />
              {renderGrid(customer)}
            </>
          ) : null}
        </View>
      </ScrollView>

      <FloatingVoucherButton
        options={voucherOptions}
        onSelect={handleVoucher}
        bottomOffset={insets.bottom + 40}
      />

      <BottomNavigation items={navItems} active="reports" onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: SCREEN_PADDING, paddingTop: spacing.md },
  filterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.textSecondary, fontSize: fontSize.label, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.white },
  snapHeader: { marginBottom: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: '50%', padding: spacing.xxs + 2 },
  sectionGap: { height: spacing.lg },
  gridRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  gridSpacer: { flex: 1 },
});

export default PremiumReportsScreen;
