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
import { reportService, BalanceSheetGroup } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';
import ReportPeriodFilterModal, {
  ReportPeriodKey,
  REPORT_PERIOD_OPTIONS,
} from '../../components/reports/ReportPeriodFilterModal';

const PRIMARY_BLUE = '#0D47A1';

const periodLabel = (key: ReportPeriodKey) =>
  REPORT_PERIOD_OPTIONS.find((o) => o.key === key)?.label ?? 'This Month';

const BalanceSheetScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>('this_month');
  const [filterVisible, setFilterVisible] = useState(false);

  const fetchBalanceSheet = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Please select a company to view Balance Sheet.');
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await reportService.getBalanceSheetReport({
        companyId: selectedCompany.id,
        periodKey,
      });
      setData(response.data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Unable to load Balance Sheet data';
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany?.id, periodKey]);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    fetchBalanceSheet();
  }, [fetchBalanceSheet, selectedCompany?.id]);

  const groups: BalanceSheetGroup[] = data?.groups || [];

  const renderGroupRow = (g: BalanceSheetGroup) => (
    <TouchableOpacity
      key={g.name}
      style={styles.row}
      disabled={!g.drillable}
      onPress={() =>
        navigation.navigate('ProfitLossGroup', {
          groupName: g.name,
          periodKey,
          groupAmount: g.amount,
          reportKind: 'balance_sheet',
        })
      }
      activeOpacity={g.drillable ? 0.7 : 1}
    >
      <Text style={styles.rowLabel} numberOfLines={2}>
        {g.name}
      </Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowAmount}>{formatCurrency(g.amount)}</Text>
        {g.drillable ? <Icon name="chevron-right" size={20} color={PRIMARY_BLUE} /> : null}
      </View>
    </TouchableOpacity>
  );

  const renderRows = (rows: Array<{ account: string; amount: number }>) =>
    (rows || []).map((row) => (
      <View key={row.account} style={styles.row}>
        <Text style={styles.rowLabel} numberOfLines={2}>
          {row.account}
        </Text>
        <Text style={styles.rowAmount}>{formatCurrency(row.amount)}</Text>
      </View>
    ));

  if (!selectedCompany) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{t('reports.selectCompany')}</Text>
      </View>
    );
  }

  const asOf = data?.period?.asOfDate;

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Icon name="arrow-left" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('reports.item.balanceSheet.title')}</Text>
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
          {asOf ? (
            <Text style={styles.periodText}>As on {formatDate(new Date(asOf))}</Text>
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
            <TouchableOpacity onPress={fetchBalanceSheet} style={styles.retryBtn}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t('reports.balanceSheet.totalAssets')}</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(data?.assets?.total || 0)}
              </Text>
            </Card>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t('reports.balanceSheet.totalLiabilities')}</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(data?.liabilities?.total || 0)}
              </Text>
            </Card>
            <Card style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t('reports.balanceSheet.totalEquity')}</Text>
              <Text style={styles.summaryValue}>
                {formatCurrency(data?.equity?.total || 0)}
              </Text>
            </Card>

            {groups.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('reports.groupsHint')}</Text>
                <Card style={styles.detailCard}>
                  {groups.map(renderGroupRow)}
                </Card>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>{t('reports.balanceSheet.assets')}</Text>
            <Card style={styles.detailCard}>
              {renderRows(data?.assets?.current)}
              {!data?.assets?.current?.length ? (
                <Text style={styles.emptyText}>{t('reports.balanceSheet.noAssets')}</Text>
              ) : null}
            </Card>

            <Text style={styles.sectionTitle}>{t('reports.balanceSheet.liabilities')}</Text>
            <Card style={styles.detailCard}>
              {renderRows(data?.liabilities?.current)}
              {!data?.liabilities?.current?.length ? (
                <Text style={styles.emptyText}>{t('reports.balanceSheet.noLiabilities')}</Text>
              ) : null}
            </Card>

            <Text style={styles.sectionTitle}>{t('reports.balanceSheet.equity')}</Text>
            <Card style={styles.detailCard}>
              {renderRows(data?.equity?.current)}
              {!data?.equity?.current?.length ? (
                <Text style={styles.emptyText}>{t('reports.balanceSheet.noEquity')}</Text>
              ) : null}
              <Divider style={styles.divider} />
              <Text style={styles.balanceNote}>
                {data?.balanceCheck?.balanced
                  ? 'Assets match liabilities + equity'
                  : 'Review sync — totals may not balance'}
              </Text>
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

export default BalanceSheetScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f7fb' },
  contentContainer: { padding: 16, paddingBottom: 32 },
  header: {
    backgroundColor: PRIMARY_BLUE,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backBtn: { marginRight: 8, padding: 4 },
  title: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '700' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', padding: 6 },
  filterBtnText: { color: '#fff', marginLeft: 4, fontSize: 14, fontWeight: '600' },
  subtitle: { color: '#bbdefb', fontSize: 14, marginBottom: 6 },
  periodBadge: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  periodText: { color: '#e3f2fd', fontSize: 13 },
  syncHint: { color: '#90caf9', fontSize: 12, marginTop: 6 },
  loading: { marginTop: 32 },
  centered: { alignItems: 'center', marginTop: 24, padding: 16 },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center', padding: 8 },
  errorText: { color: '#c62828', fontSize: 15, textAlign: 'center' },
  retryBtn: { marginTop: 12 },
  retryText: { color: PRIMARY_BLUE, fontWeight: '600', fontSize: 16 },
  summaryCard: { padding: 16, borderRadius: 14, marginBottom: 10, backgroundColor: '#fff' },
  summaryLabel: { fontSize: 13, color: '#555', marginBottom: 6 },
  summaryValue: { fontSize: 22, fontWeight: '700', color: PRIMARY_BLUE },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    marginTop: 16,
    marginBottom: 8,
  },
  detailCard: { padding: 16, borderRadius: 14, backgroundColor: '#fff' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowLabel: { flex: 1, color: '#333', fontSize: 14, marginRight: 8 },
  rowAmount: { color: '#222', fontSize: 14, fontWeight: '600' },
  divider: { marginVertical: 12, backgroundColor: '#e0e0e0' },
  balanceNote: { color: '#666', fontSize: 13, textAlign: 'center' },
});
