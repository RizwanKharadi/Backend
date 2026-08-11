import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Card, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useCompany } from '../../store/hooks';
import { reportService, ProfitLossGroup } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';
import ReportPeriodFilterModal, {
  ReportPeriodKey,
  REPORT_PERIOD_OPTIONS,
} from '../../components/reports/ReportPeriodFilterModal';

const PRIMARY_BLUE = '#0D47A1';
const POSITIVE_GREEN = '#2e7d32';
const NEGATIVE_RED = '#c62828';

const periodLabel = (key: ReportPeriodKey) =>
  REPORT_PERIOD_OPTIONS.find((o) => o.key === key)?.label ?? 'This Month';

const ProfitLossScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>('this_month');
  const [filterVisible, setFilterVisible] = useState(false);

  const fetchProfitLoss = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Please select a company to view Profit & Loss.');
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await reportService.getProfitLossReport({
        companyId: selectedCompany.id,
        periodKey,
      });
      setData(response.data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Unable to load Profit & Loss data';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany?.id, periodKey]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetchProfitLoss();
  }, [fetchProfitLoss, selectedCompany?.id]);

  const summary = data?.summary || {};
  const groups: ProfitLossGroup[] = data?.groups || [];
  const revenueGroups = groups.filter((g) => g.side === 'revenue');
  const expenseGroups = groups.filter((g) => g.side === 'expense');
  const revenueCategories = data?.revenue?.byCategory || {};
  const expenseCategories = data?.expenses?.byCategory || {};
  const periodStart = data?.period?.startDate;
  const periodEnd = data?.period?.endDate;

  const renderGroupRow = (g: ProfitLossGroup) => (
    <TouchableOpacity
      key={g.name}
      style={styles.categoryRow}
      disabled={!g.drillable}
      onPress={() =>
        navigation.navigate('ProfitLossGroup', {
          groupName: g.name,
          periodKey,
          groupAmount: g.amount,
        })
      }
      activeOpacity={g.drillable ? 0.7 : 1}
    >
      <Text style={styles.categoryText}>{g.name}</Text>
      <View style={styles.categoryRight}>
        <Text style={styles.categoryAmount}>{formatCurrency(g.amount)}</Text>
        {g.drillable ? (
          <Icon name="chevron-right" size={20} color={PRIMARY_BLUE} />
        ) : null}
      </View>
    </TouchableOpacity>
  );

  const getCategoryRows = (categories: Record<string, number>) =>
    Object.entries(categories).map(([name, amount]) => (
      <View key={name} style={styles.categoryRow}>
        <Text style={styles.categoryText}>{name}</Text>
        <Text style={styles.categoryAmount}>{formatCurrency(amount)}</Text>
      </View>
    ));

  if (!selectedCompany) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{t('reports.selectCompany')}</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Icon name="arrow-left" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('reports.item.profitLoss.title')}</Text>
            <TouchableOpacity
              onPress={() => setFilterVisible(true)}
              style={styles.filterBtn}
            >
              <Icon name="filter-variant" size={22} color="#fff" />
              <Text style={styles.filterBtnText}>{t('reports.filter')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>{selectedCompany.name}</Text>
          <Text style={styles.periodBadge}>{periodLabel(periodKey)}</Text>
          {periodStart && periodEnd ? (
            <Text style={styles.periodText}>
              {formatDate(new Date(periodStart))} → {formatDate(new Date(periodEnd))}
            </Text>
          ) : null}
          {data?.lastSyncDate ? (
            <Text style={styles.syncHint}>
              Last synced: {formatDate(new Date(data.lastSyncDate))}
            </Text>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator style={styles.loading} color={PRIMARY_BLUE} size="large" />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={fetchProfitLoss} style={styles.retryBtn}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <Card style={[styles.summaryCard, styles.revenueCard]}>
                <Text style={styles.summaryLabel}>{t('reports.profitLoss.revenue')}</Text>
                <Text style={styles.summaryValue}>
                  {formatCurrency(summary.totalRevenue || 0)}
                </Text>
              </Card>
              <Card style={[styles.summaryCard, styles.expenseCard]}>
                <Text style={styles.summaryLabel}>{t('reports.profitLoss.expenses')}</Text>
                <Text style={styles.summaryValue}>
                  {formatCurrency(summary.totalExpenses || 0)}
                </Text>
              </Card>
            </View>

            <Card style={[styles.detailCard, styles.netCard]}>
              <Text style={styles.summaryLabel}>{t('dashboard.netProfit')}</Text>
              <Text
                style={[
                  styles.summaryValue,
                  { color: (summary.netProfit ?? 0) >= 0 ? POSITIVE_GREEN : NEGATIVE_RED },
                ]}
              >
                {formatCurrency(summary.netProfit || 0)}
              </Text>
              <Text style={styles.profitMarginText}>
                Profit Margin: {summary.profitMargin ?? 0}%
              </Text>
            </Card>

            <View style={styles.breakdownHeader}>
              <Text style={styles.sectionTitle}>{t('reports.profitLoss.incomeBreakdown')}</Text>
            </View>
            <Card style={styles.detailCard}>
              {revenueGroups.length > 0 ? (
                revenueGroups.map(renderGroupRow)
              ) : Object.keys(revenueCategories).length > 0 ? (
                getCategoryRows(revenueCategories)
              ) : (
                <Text style={styles.emptyText}>
                  {t('reports.profitLoss.noIncomeGroups')}
                </Text>
              )}
            </Card>

            <View style={styles.breakdownHeader}>
              <Text style={styles.sectionTitle}>{t('reports.profitLoss.expenseBreakdown')}</Text>
            </View>
            <Card style={styles.detailCard}>
              {expenseGroups.length > 0 ? (
                expenseGroups.map(renderGroupRow)
              ) : Object.keys(expenseCategories).length > 0 ? (
                getCategoryRows(expenseCategories)
              ) : (
                <Text style={styles.emptyText}>
                  {t('reports.profitLoss.noExpenseGroups')}
                </Text>
              )}
            </Card>

            <Card style={styles.detailCard}>
              <Text style={styles.sectionTitle}>{t('vouchers.item.summary')}</Text>
              <Divider style={styles.divider} />
              <View style={styles.summaryLine}>
                <Text style={styles.summaryLineLabel}>{t('reports.profitLoss.totalIncome')}</Text>
                <Text style={styles.summaryLineValue}>
                  {formatCurrency(data?.revenue?.total || 0)}
                </Text>
              </View>
              <View style={styles.summaryLine}>
                <Text style={styles.summaryLineLabel}>{t('reports.profitLoss.totalExpenses')}</Text>
                <Text style={styles.summaryLineValue}>
                  {formatCurrency(data?.expenses?.total || 0)}
                </Text>
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      <ReportPeriodFilterModal
        visible={filterVisible}
        selectedKey={periodKey}
        onClose={() => setFilterVisible(false)}
        onSelect={setPeriodKey}
      />
    </>
  );
};

export default ProfitLossScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7fb' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  header: {
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backBtn: { marginRight: 8, padding: 4 },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
  },
  filterBtnText: { color: '#fff', marginLeft: 4, fontSize: 14, fontWeight: '600' },
  subtitle: { color: '#bbdefb', fontSize: 14, marginBottom: 6 },
  periodBadge: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  periodText: { color: '#e3f2fd', fontSize: 13 },
  syncHint: { color: '#90caf9', fontSize: 12, marginTop: 6 },
  loading: { marginTop: 32 },
  centered: { alignItems: 'center', marginTop: 24, padding: 16 },
  emptyText: { color: '#555', fontSize: 15, textAlign: 'center' },
  errorText: { color: NEGATIVE_RED, fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: 12 },
  retryText: { color: PRIMARY_BLUE, fontWeight: '600', fontSize: 16 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { flex: 1, padding: 16, borderRadius: 14 },
  revenueCard: { backgroundColor: '#e8f5e9' },
  expenseCard: { backgroundColor: '#ffebee' },
  detailCard: { padding: 16, borderRadius: 14, marginTop: 12 },
  netCard: { backgroundColor: '#fffde7' },
  summaryLabel: { fontSize: 13, color: '#555', marginBottom: 6 },
  summaryValue: { fontSize: 24, fontWeight: '700', color: PRIMARY_BLUE },
  profitMarginText: { marginTop: 6, color: '#4a4a4a', fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10, color: '#222' },
  breakdownHeader: { marginTop: 20, marginBottom: 10 },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  categoryText: { color: '#333', fontSize: 14, flex: 1 },
  categoryRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  categoryAmount: { color: '#222', fontSize: 14, fontWeight: '600' },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  summaryLineLabel: { color: '#555', fontSize: 14 },
  summaryLineValue: { color: '#222', fontSize: 14, fontWeight: '700' },
  divider: { marginVertical: 10, backgroundColor: '#e0e0e0' },
});
