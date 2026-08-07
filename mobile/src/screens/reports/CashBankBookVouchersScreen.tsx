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
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCompany } from '../../store/hooks';
import { reportService, ProfitLossVoucherRow } from '../../services/reportService';
import { formatCurrency } from '../../utils/formatters';
import { ReportPeriodKey } from '../../components/reports/ReportPeriodFilterModal';
import MonthFilterBar, { MonthRange } from '../../components/reports/MonthFilterBar';

const PRIMARY = '#1565C0';

type RouteParams = {
  ledgerName: string;
  periodKey: ReportPeriodKey;
  parentGroup?: string;
};

const CashBankBookVouchersScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { selectedCompany } = useCompany();
  const { ledgerName, periodKey } = (route.params || {}) as RouteParams;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vouchers, setVouchers] = useState<ProfitLossVoucherRow[]>([]);
  const [month, setMonth] = useState<MonthRange | null>(null);

  const load = useCallback(async () => {
    if (!selectedCompany?.id || !ledgerName) {
      setError('Missing company or ledger.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getCashBankBookVouchers({
        companyId: selectedCompany.id,
        periodKey: periodKey || 'this_month',
        ledgerName,
        // Server-side: an explicit range overrides the period preset.
        ...(month || {}),
      });
      setVouchers(res.data.vouchers || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load vouchers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, ledgerName, periodKey, month]);

  useEffect(() => {
    load();
  }, [load]);

  const renderRow = ({ item }: { item: ProfitLossVoucherRow }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() =>
        navigation.getParent()?.navigate('VoucherDetail', { voucherId: item.id })
      }
      activeOpacity={0.7}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.vchNo}>
          {item.voucherNumber}{' '}
          <Text style={styles.vchType}>({item.voucherType})</Text>
        </Text>
        <Text style={styles.party} numberOfLines={1}>
          {item.partyName || '—'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
        <Text style={styles.date}>
          {item.dateDisplay ||
            (item.date ? new Date(item.date).toLocaleDateString() : '—')}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ledgerName}
          </Text>
          <Text style={styles.headerSub}>Receipt · Payment · Contra</Text>
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
        <>
        <MonthFilterBar value={month} onChange={setMonth} accentColor={PRIMARY} />
        <FlatList
          data={vouchers}
          keyExtractor={(item) => item.id}
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
          ListHeaderComponent={
            <Text style={styles.countLabel}>{vouchers.length} voucher(s)</Text>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              No receipt, payment or contra vouchers for &quot;{ledgerName}&quot;
              {month ? ' in the selected month.' : ' in this period.'}
            </Text>
          }
        />
        </>
      )}
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
  countLabel: {
    padding: 12,
    fontSize: 13,
    color: '#666',
    backgroundColor: '#e8eef5',
  },
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowLeft: { flex: 1, paddingRight: 8 },
  vchNo: { fontSize: 15, fontWeight: '600', color: '#222' },
  vchType: { fontSize: 13, fontWeight: '400', color: '#666' },
  party: { fontSize: 13, color: '#666', marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  amount: { fontSize: 15, fontWeight: '600', color: '#8B4513' },
  date: { fontSize: 12, color: '#888', marginTop: 2 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', padding: 24 },
});

export default CashBankBookVouchersScreen;
