/**
 * PremiumReportsScreen — TallyFin Reports as a Business Intelligence hub.
 *
 * Fixed category filter (All / Financial / Inventory / Customer, no scroll)
 * then 2-column report grids. Report cards open the existing report screens;
 * reports without a screen yet show a "Soon" badge.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';

import TransactionHeader from '../components/TransactionHeader';
import SectionHeader from '../components/SectionHeader';
import ReportCard from '../components/ReportCard';
import FloatingVoucherButton from '../components/FloatingVoucherButton';
import BottomNavigation from '../components/BottomNavigation';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { navItems } from '../data/dashboardMockData';
import { DashboardTab } from '../types/dashboard';

import { useCompany, useNotification } from '../store/hooks';
import { toLocalDateString } from '../utils/formatters';

const SCREEN_PADDING = spacing.md;

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

  const { selectedCompany } = useCompany();
  const { unreadCount } = useNotification();

  const [activeCat, setActiveCat] = useState<Category>('all');

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

  const handleVoucher = useCallback(() => go('CreateNewVoucher', {}), [go]);

  // ---- Report catalogue ----
  const financial: ReportDef[] = [
    { icon: 'chart-line', color: colors.info, title: 'Profit & Loss', description: 'Income statement and profitability', badge: 'Most used', route: 'ProfitLoss' },
    { icon: 'bank', color: colors.info, title: 'Balance Sheet', description: 'Assets, liabilities and equity', route: 'BalanceSheet' },
    { icon: 'cash-multiple', color: colors.info, title: 'Cash / Bank Book', description: 'Cash-in-hand, bank accounts and OD balances', route: 'CashBankBook' },
    { icon: 'account-cash-outline', color: colors.info, title: 'Receivables', description: 'Bills receivable by ledger', route: 'OutstandingReceivable' },
    { icon: 'account-arrow-up-outline', color: colors.info, title: 'Payables', description: 'Bills payable by ledger', route: 'OutstandingPayable' },
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
      {/* No pull-to-refresh: this screen is a static catalogue of report links
          since the Business Snapshot was removed — there is nothing to refetch. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
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
        onPress={handleVoucher}
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
  sectionGap: { height: spacing.lg },
  gridRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  gridSpacer: { flex: 1 },
});

export default PremiumReportsScreen;
