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
import { useTranslation } from 'react-i18next';

const SCREEN_PADDING = spacing.md;

type Category = 'all' | 'financial' | 'inventory' | 'customer';

// Keys, not text: module scope is out of reach of any hook.
const CATEGORIES: { key: Category; labelKey: string; icon: string }[] = [
  { key: 'all', labelKey: 'reports.category.all', icon: 'view-grid-outline' },
  { key: 'financial', labelKey: 'reports.category.financial', icon: 'chart-line' },
  { key: 'inventory', labelKey: 'reports.category.inventory', icon: 'package-variant-closed' },
  { key: 'customer', labelKey: 'reports.category.customer', icon: 'account-group-outline' },
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
  const { t } = useTranslation();
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
    { icon: 'chart-line', color: colors.info, title: t('reports.item.profitLoss.title'), description: t('reports.item.profitLoss.description'), badge: t('reports.mostUsed'), route: 'ProfitLoss' },
    { icon: 'bank', color: colors.info, title: t('reports.item.balanceSheet.title'), description: t('reports.item.balanceSheet.description'), route: 'BalanceSheet' },
    { icon: 'cash-multiple', color: colors.info, title: t('reports.item.cashBankBook.title'), description: t('reports.item.cashBankBook.description'), route: 'CashBankBook' },
    { icon: 'account-cash-outline', color: colors.info, title: t('dashboard.receivablesTitle'), description: t('reports.item.receivables.description'), route: 'OutstandingReceivable' },
    { icon: 'account-arrow-up-outline', color: colors.info, title: t('dashboard.payables'), description: t('reports.item.payables.description'), route: 'OutstandingPayable' },
    { icon: 'book-open-variant', color: colors.info, title: t('reports.item.dayBook.title'), description: t('reports.item.dayBook.description'), route: 'DayBook', params: {} },
  ];

  const inventory: ReportDef[] = [
    { icon: 'cube-outline', color: colors.green, title: t('reports.item.inventoryValuation.title'), description: t('reports.item.inventoryValuation.description'), route: 'InventoryList' },
    { icon: 'swap-horizontal', color: colors.green, title: t('reports.item.stockMovement.title'), description: t('reports.item.stockMovement.description'), soon: true },
    { icon: 'timer-sand-empty', color: colors.green, title: t('reports.item.inactiveItems.title'), description: t('reports.item.inactiveItems.description'), route: 'InactiveItem' },
    { icon: 'alert-outline', color: colors.green, title: t('reports.item.lowStock.title'), description: t('reports.item.lowStock.description'), route: 'InventoryList' },
    { icon: 'close-circle-outline', color: colors.green, title: t('inventory.filters.outOfStock'), description: t('reports.item.outOfStock.description'), route: 'InventoryList' },
    { icon: 'trending-up', color: colors.green, title: t('reports.item.fastMoving.title'), description: t('reports.item.fastMoving.description'), route: 'FastMovingItems' },
  ];

  const customer: ReportDef[] = [
    { icon: 'trophy-outline', color: colors.kpiPurple, title: t('reports.item.topTen.title'), description: t('reports.item.topTen.description'), route: 'TopTenReport' },
    { icon: 'account-cash-outline', color: colors.kpiPurple, title: t('reports.item.outstandingReceivable.title'), description: t('reports.item.receivables.description'), route: 'OutstandingReceivable' },
    { icon: 'account-clock-outline', color: colors.kpiPurple, title: t('reports.item.inactiveCustomers.title'), description: t('reports.item.inactiveCustomers.description'), route: 'InactiveCustomer' },
    { icon: 'chart-bar', color: colors.kpiPurple, title: t('reports.item.salesAnalysis.title'), description: t('reports.item.salesAnalysis.description'), route: 'FilteredVouchers', params: { voucherType: 'sales', title: t('reports.sales') } },
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
          title={t('nav.reports')}
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
                    {t(c.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {showFinancial ? (
            <>
              <View style={styles.sectionGap} />
              <SectionHeader title={t('reports.section.financial')} icon="chart-line" accentColor={colors.info} />
              {renderGrid(financial)}
            </>
          ) : null}

          {showInventory ? (
            <>
              <View style={styles.sectionGap} />
              <SectionHeader title={t('reports.section.inventory')} icon="package-variant-closed" accentColor={colors.green} />
              {renderGrid(inventory)}
            </>
          ) : null}

          {showCustomer ? (
            <>
              <View style={styles.sectionGap} />
              <SectionHeader title={t('reports.section.customer')} icon="account-group-outline" accentColor={colors.kpiPurple} />
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
