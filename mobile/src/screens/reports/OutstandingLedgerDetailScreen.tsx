import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCompany } from '../../store/hooks';
import {
  reportService,
  OutstandingBill,
  OutstandingKind,
} from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/formatters';

const PRIMARY = '#1565C0';
const AMOUNT_COLOR = '#8B4513';

type RouteParams = { partyName: string; kind?: OutstandingKind };

const OutstandingLedgerDetailScreen = () => {
  const navigation = useNavigation();
  const rootNavigation =
    navigation.getParent()?.getParent() ?? navigation.getParent();
  const route = useRoute();
  const { partyName, kind: rawKind } = (route.params || {}) as RouteParams;
  const kind: OutstandingKind = rawKind === 'payable' ? 'payable' : 'receivable';
  const { selectedCompany } = useCompany();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [bills, setBills] = useState<OutstandingBill[]>([]);

  const load = useCallback(async () => {
    if (!selectedCompany?.id || !partyName) {
      setError('Missing company or ledger.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getOutstandingLedger(
        kind,
        selectedCompany.id,
        partyName
      );
      setTotalOutstanding(res.data.totalOutstanding || 0);
      setAsOfDate(res.data.asOfDate || null);
      setBills(res.data.bills || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load ledger outstanding');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, partyName, kind]);

  useEffect(() => {
    load();
  }, [load]);

  const renderBill = ({ item }: { item: OutstandingBill }) => {
    const billDate = item.billDate ? formatDate(item.billDate) : '—';
    const dueDate = item.billDue ? formatDate(item.billDue) : '—';
    const overdue =
      item.billOverdue != null && !Number.isNaN(Number(item.billOverdue))
        ? `${item.billOverdue} Days`
        : '—';

    const canOpenVoucher = Boolean(item.voucherId);

    return (
      <TouchableOpacity
        style={styles.billRow}
        activeOpacity={canOpenVoucher ? 0.75 : 1}
        disabled={!canOpenVoucher}
        onPress={() => {
          if (!item.voucherId) return;
          rootNavigation?.navigate('VoucherDetail', { voucherId: item.voucherId });
        }}
      >
        <View style={styles.billTop}>
          <Text style={styles.billRef}>{item.billRef || '—'}</Text>
          <Text style={styles.billAmount}>{formatCurrency(item.closingBalance)}</Text>
        </View>
        <Text style={styles.billMeta}>
          {billDate} · {overdue} · Due: {dueDate}
        </Text>
        {item.vchNumber ? (
          <Text style={styles.billVch}>
            {item.vchType || 'Voucher'} #{item.vchNumber}
          </Text>
        ) : null}
        {canOpenVoucher ? (
          <Text style={styles.billLink}>View voucher</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  const asOfLabel = asOfDate
    ? `As of ${formatDate(asOfDate)} | All`
    : 'As of today | All';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {partyName}
        </Text>
        <View style={styles.headerActions}>
          <Icon name="filter-variant" size={22} color="#fff" style={styles.headerIcon} />
        </View>
      </View>

      <View style={styles.summaryBlock}>
        <Text style={styles.totalAmount}>{formatCurrency(totalOutstanding)}</Text>
        <Text style={styles.asOfText}>{asOfLabel}</Text>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.selectLink}>Select</Text>
        <Icon name="chart-bar" size={20} color={PRIMARY} />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}>
            <Text style={styles.retry}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(item, idx) => `${item.billRef}-${idx}`}
          renderItem={renderBill}
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
            <Text style={styles.empty}>No outstanding bills for this ledger.</Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  headerBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 4,
  },
  headerActions: { flexDirection: 'row' },
  headerIcon: { marginLeft: 12 },
  summaryBlock: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: 'center',
  },
  totalAmount: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
  },
  asOfText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 4,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  selectLink: { color: PRIMARY, fontSize: 14 },
  billRow: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  billTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  billRef: { fontSize: 16, fontWeight: '600', color: '#222' },
  billAmount: { fontSize: 16, fontWeight: '600', color: AMOUNT_COLOR },
  billMeta: { fontSize: 12, color: '#888', marginTop: 6 },
  billVch: { fontSize: 11, color: '#aaa', marginTop: 4 },
  billLink: { fontSize: 12, color: PRIMARY, marginTop: 8, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666' },
  errorBox: { padding: 24, alignItems: 'center' },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
});

export default OutstandingLedgerDetailScreen;
