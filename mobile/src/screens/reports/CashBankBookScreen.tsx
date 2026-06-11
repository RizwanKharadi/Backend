import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCompany } from '../../store/hooks';
import {
  reportService,
  CashBankBookSection,
} from '../../services/reportService';
import { formatCurrency } from '../../utils/formatters';
import ReportPeriodFilterModal, {
  ReportPeriodKey,
  REPORT_PERIOD_OPTIONS,
} from '../../components/reports/ReportPeriodFilterModal';

const PRIMARY = '#1565C0';

const formatBalance = (value: number) =>
  value > 0 ? formatCurrency(value) : '—';

const CashBankBookScreen = () => {
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<CashBankBookSection[]>([]);
  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>('this_month');
  const [periodLabel, setPeriodLabel] = useState('This Month');
  const [filterVisible, setFilterVisible] = useState(false);

  const load = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Please select a company.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getCashBankBookSummary({
        companyId: selectedCompany.id,
        periodKey,
      });
      setSections(res.data.sections || []);
      setPeriodLabel(res.data.period?.label || periodLabel);
    } catch (e: any) {
      setError(
        e?.response?.status === 404
          ? 'API not found — deploy or restart the backend with cash-bank-book routes.'
          : e?.response?.data?.message ||
              e?.message ||
              'Failed to load Cash/Bank Book. Re-run sync on desktop-agent.'
      );
      setSections([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, periodKey]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const renderRow = ({ item }: { item: CashBankBookSection }) => (
    <TouchableOpacity
      style={styles.row}
      disabled={!item.drillable}
      onPress={() =>
        navigation.navigate('CashBankBookLedgers', {
          parentGroup: item.parentGroup || item.name,
          periodKey,
          groupDebit: item.debit,
          groupCredit: item.credit,
        })
      }
      activeOpacity={item.drillable ? 0.7 : 1}
    >
      <Text style={styles.rowName} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={styles.amountCols}>
        <Text style={styles.amount}>{formatBalance(item.debit)}</Text>
        <Text style={styles.amount}>{formatBalance(item.credit)}</Text>
      </View>
      {item.drillable ? (
        <Icon name="chevron-right" size={20} color="#888" style={styles.chevron} />
      ) : (
        <View style={styles.chevron} />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Cash/Bank Book</Text>
          <Text style={styles.headerSub}>{periodLabel}</Text>
        </View>
        <TouchableOpacity onPress={() => setFilterVisible(true)} style={styles.headerBtn}>
          <Icon name="filter-variant" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.colHeader}>
        <Text style={styles.colParticulars}>Particulars</Text>
        <View style={styles.colClosing}>
          <Text style={styles.colClosingLabel}>Closing Balance</Text>
          <View style={styles.colDebitCredit}>
            <Text style={styles.colSub}>Debit</Text>
            <Text style={styles.colSub}>Credit</Text>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}>
            <Text style={styles.retry}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.parentGroup || item.name}
          renderItem={renderRow}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              colors={[PRIMARY]}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              No cash or bank groups found. Run desktop-agent sync with Tally open.
            </Text>
          }
        />
      )}

      <ReportPeriodFilterModal
        visible={filterVisible}
        selectedKey={periodKey}
        onClose={() => setFilterVisible(false)}
        onSelect={(key) => {
          setPeriodKey(key);
          setPeriodLabel(
            REPORT_PERIOD_OPTIONS.find((o) => o.key === key)?.label ?? key
          );
          setFilterVisible(false);
          setLoading(true);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  headerBtn: { padding: 8 },
  headerCenter: { flex: 1, marginLeft: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  colParticulars: {
    flex: 1,
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  },
  colClosing: { alignItems: 'flex-end', minWidth: 160 },
  colClosingLabel: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    marginBottom: 4,
  },
  colDebitCredit: { flexDirection: 'row', gap: 24 },
  colSub: { fontSize: 11, color: '#aaa', fontWeight: '600', width: 72, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    paddingRight: 8,
  },
  amountCols: { flexDirection: 'row', gap: 24 },
  amount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B4513',
    width: 72,
    textAlign: 'right',
  },
  chevron: { width: 20, marginLeft: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', padding: 24 },
});

export default CashBankBookScreen;
