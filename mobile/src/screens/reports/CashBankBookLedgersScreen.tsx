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
import {
  reportService,
  ProfitLossGroupLedger,
} from '../../services/reportService';
import { formatCurrency } from '../../utils/formatters';
import { ReportPeriodKey } from '../../components/reports/ReportPeriodFilterModal';

const PRIMARY = '#1565C0';

const formatBalance = (value: number) =>
  value > 0 ? formatCurrency(value) : '—';

type RouteParams = {
  parentGroup: string;
  periodKey: ReportPeriodKey;
  groupDebit?: number;
  groupCredit?: number;
};

const CashBankBookLedgersScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { selectedCompany } = useCompany();
  const {
    parentGroup,
    periodKey,
    groupDebit,
    groupCredit,
  } = (route.params || {}) as RouteParams;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<ProfitLossGroupLedger[]>([]);
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });

  const load = useCallback(async () => {
    if (!selectedCompany?.id || !parentGroup) {
      setError('Missing company or group.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getCashBankBookLedgers({
        companyId: selectedCompany.id,
        periodKey: periodKey || 'this_month',
        parentGroup,
      });
      const rows = (res.data.ledgers || []).filter((l) => !l.isGroup);
      setLedgers(rows);
      setTotals({
        debit: res.data.debit ?? groupDebit ?? 0,
        credit: res.data.credit ?? groupCredit ?? 0,
      });
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          e?.message ||
          'Failed to load ledgers. Re-run sync on desktop-agent.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, parentGroup, periodKey, groupDebit, groupCredit]);

  useEffect(() => {
    load();
  }, [load]);

  const renderRow = ({ item }: { item: ProfitLossGroupLedger }) => {
    const label = item.displayName || item.name;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() =>
          navigation.navigate('CashBankBookVouchers', {
            ledgerName: label,
            periodKey: periodKey || 'this_month',
            parentGroup,
          })
        }
        activeOpacity={0.7}
      >
        <Text style={styles.rowName} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.amountCols}>
          <Text style={styles.amount}>{formatBalance(item.debit)}</Text>
          <Text style={styles.amount}>{formatBalance(item.credit)}</Text>
        </View>
        <Icon name="chevron-right" size={20} color="#888" style={styles.chevron} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {parentGroup}
          </Text>
          <View style={styles.headerTotals}>
            <Text style={styles.headerSub}>
              Dr {formatBalance(totals.debit)}
            </Text>
            <Text style={styles.headerSub}>
              Cr {formatBalance(totals.credit)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.colHeader}>
        <Text style={styles.colParticulars}>Particulars</Text>
        <View style={styles.colDebitCredit}>
          <Text style={styles.colSub}>Debit</Text>
          <Text style={styles.colSub}>Credit</Text>
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
          data={ledgers}
          keyExtractor={(item, i) => `${item.name}-${i}`}
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
              No ledgers synced for this group. Run desktop-agent sync.
            </Text>
          }
        />
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
  headerTotals: { flexDirection: 'row', gap: 16, marginTop: 4 },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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
  colDebitCredit: { flexDirection: 'row', gap: 24, marginRight: 24 },
  colSub: { fontSize: 12, color: '#888', fontWeight: '600', width: 72, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingLeft: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowName: { flex: 1, fontSize: 15, color: '#222', paddingRight: 8 },
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

export default CashBankBookLedgersScreen;
