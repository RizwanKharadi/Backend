import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import ReportsHeader from '../components/reports/ReportsHeader';
import { dashboardColors } from '../components/dashboard/dashboardTheme';
import { useCompany } from '../store/hooks';
import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { MainTabParamList, ReportsStackParamList } from '../types/navigation';

type Props = CompositeScreenProps<
  NativeStackScreenProps<ReportsStackParamList, 'ReportsHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

type ReportCategory = 'all' | 'financial' | 'inventory' | 'customer' | 'vouchers';

interface ReportItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: Exclude<ReportCategory, 'all'>;
}

const REPORTS: ReportItem[] = [
  {
    id: 'top_10',
    title: 'Top 10 Report',
    description: 'Top customers, suppliers and items by value or quantity',
    icon: 'trophy',
    category: 'customer',
  },
  {
    id: 'profit_loss',
    title: 'Profit & Loss',
    description: 'Income statement and profitability',
    icon: 'chart-line',
    category: 'financial',
  },
  {
    id: 'balance_sheet',
    title: 'Balance Sheet',
    description: 'Assets, liabilities and equity',
    icon: 'bank',
    category: 'financial',
  },
  {
    id: 'cash_bank_book',
    title: 'Cash/Bank Book',
    description: 'Cash-in-hand, bank accounts and OD balances',
    icon: 'cash-multiple',
    category: 'financial',
  },
  {
    id: 'inventory_valuation',
    title: 'Inventory Valuation',
    description: 'Stock value and movement',
    icon: 'package-variant',
    category: 'inventory',
  },
  {
    id: 'stock_movement',
    title: 'Stock Movement',
    description: 'Inventory transfers and adjustments',
    icon: 'swap-horizontal',
    category: 'inventory',
  },
  {
    id: 'outstanding_receivable',
    title: 'Outstanding Receivable',
    description: 'Bills receivable by ledger',
    icon: 'account-cash-outline',
    category: 'customer',
  },
  {
    id: 'inactive_customer',
    title: 'Inactive Customer',
    description: 'Customers with no bill for 30+ days',
    icon: 'account-clock-outline',
    category: 'customer',
  },
  {
    id: 'inactive_item',
    title: 'Inactive Item',
    description: 'Stock items not sold for 30+ days',
    icon: 'package-variant-closed',
    category: 'inventory',
  },
];

const CATEGORY_CHIPS: { id: ReportCategory; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'view-grid-outline' },
  { id: 'financial', label: 'Financial', icon: 'chart-line' },
  { id: 'inventory', label: 'Inventory', icon: 'package-variant' },
  { id: 'customer', label: 'Customer', icon: 'account-group-outline' },
];

const CATEGORY_COLORS: Record<Exclude<ReportCategory, 'all'>, string> = {
  financial: dashboardColors.accent,
  inventory: '#06b6d4',
  customer: '#8b5cf6',
  vouchers: '#6366f1',
};

const GROUP_LABELS: Record<Exclude<ReportCategory, 'all'>, string> = {
  vouchers: 'Vouchers',
  financial: 'Financial',
  inventory: 'Inventory',
  customer: 'Customer',
};

const ReportsScreen: React.FC<Props> = ({ navigation }) => {
  const parentNavigation = navigation.getParent();
  const { selectedCompany } = useCompany();

  const [selectedCategory, setSelectedCategory] = useState<ReportCategory>('all');

  const filteredReports =
    selectedCategory === 'all'
      ? REPORTS
      : REPORTS.filter((r) => r.category === selectedCategory);

  const groupedReports =
    selectedCategory === 'all'
      ? (['customer', 'financial', 'inventory'] as const)
          .map((cat) => ({
            category: cat,
            items: REPORTS.filter((r) => r.category === cat),
          }))
          .filter((g) => g.items.length > 0)
      : [{ category: selectedCategory, items: filteredReports }];

  const handleReportPress = (reportId: string) => {
    switch (reportId) {
      case 'top_10':
        navigation.navigate('TopTenReport');
        break;
      case 'profit_loss':
        navigation.navigate('ProfitLoss');
        break;
      case 'balance_sheet':
        navigation.navigate('BalanceSheet');
        break;
      case 'cash_bank_book':
        navigation.navigate('CashBankBook');
        break;
      case 'outstanding_receivable':
        navigation.navigate('OutstandingReceivable');
        break;
      case 'inactive_customer':
        navigation.navigate('InactiveCustomer');
        break;
      case 'inactive_item':
        navigation.navigate('InactiveItem');
        break;
      case 'inventory_valuation':
      case 'stock_movement':
        parentNavigation?.navigate('Inventory');
        break;
      default:
        Alert.alert('Coming soon', 'This report will be available in a future update.');
    }
  };

  const renderReportCard = (report: ReportItem) => {
    const color = CATEGORY_COLORS[report.category];
    return (
      <TouchableOpacity
        key={report.id}
        style={styles.reportCard}
        onPress={() => handleReportPress(report.id)}
        activeOpacity={0.75}
      >
        <View style={[styles.reportIconWrap, { backgroundColor: `${color}18` }]}>
          <Icon name={report.icon} size={24} color={color} />
        </View>
        <View style={styles.reportBody}>
          <Text style={styles.reportTitle} numberOfLines={1}>
            {report.title}
          </Text>
          <Text style={styles.reportDesc} numberOfLines={2}>
            {report.description}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color={dashboardColors.muted} />
      </TouchableOpacity>
    );
  };

  const subtitle = selectedCompany?.name
    ? `${selectedCompany.name} · insights`
    : 'Business intelligence from Tally';

  return (
    <View style={styles.container}>
      <ReportsHeader
        subtitle={subtitle}
        onSyncPress={() => parentNavigation?.navigate('Sync')}
        onSettingsPress={() => parentNavigation?.navigate('Settings')}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipScrollContent}
        >
          {CATEGORY_CHIPS.map((chip) => {
            const active = selectedCategory === chip.id;
            return (
              <TouchableOpacity
                key={chip.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedCategory(chip.id)}
              >
                <Icon
                  name={chip.icon}
                  size={16}
                  color={active ? dashboardColors.accent : dashboardColors.muted}
                />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {groupedReports.map((group) => (
          <View key={group.category} style={styles.section}>
            {selectedCategory === 'all' ? (
              <View style={styles.sectionHeader}>
                <View
                  style={[
                    styles.sectionDot,
                    {
                      backgroundColor:
                        CATEGORY_COLORS[group.category as keyof typeof CATEGORY_COLORS],
                    },
                  ]}
                />
                <Text style={styles.sectionTitle}>
                  {GROUP_LABELS[group.category as keyof typeof GROUP_LABELS]}
                </Text>
                <Text style={styles.sectionCount}>{group.items.length}</Text>
              </View>
            ) : (
              <Text style={styles.sectionTitleStandalone}>
                {filteredReports.length} report{filteredReports.length !== 1 ? 's' : ''}
              </Text>
            )}
            {group.items.map(renderReportCard)}
          </View>
        ))}

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
    paddingTop: 12,
  },
  chipScroll: {
    marginBottom: 14,
    marginHorizontal: -16,
  },
  chipScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: dashboardColors.cardBg,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#eff6ff',
    borderColor: dashboardColors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.muted,
  },
  chipTextActive: {
    color: dashboardColors.accent,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: dashboardColors.muted,
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionTitleStandalone: {
    fontSize: 14,
    fontWeight: '600',
    color: dashboardColors.muted,
    marginBottom: 10,
  },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  reportIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reportBody: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  reportDesc: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 3,
    lineHeight: 17,
  },
  bottomSpacer: {
    height: 24,
  },
});

export default ReportsScreen;
