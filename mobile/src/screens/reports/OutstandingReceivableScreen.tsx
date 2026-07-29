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
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCompany } from '../../store/hooks';
import {
  reportService,
  OutstandingLedgerSummary,
} from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/formatters';

const PRIMARY = '#1565C0';
const AMOUNT_COLOR = '#8B4513';

const OutstandingReceivableScreen = () => {
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<OutstandingLedgerSummary[]>([]);

  const load = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Select a company first.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getOutstandingReceivable(selectedCompany.id);
      const data = res.data;
      setTotalOutstanding(data.totalOutstanding || 0);
      setAsOfDate(data.asOfDate || data.lastSyncedAt || null);
      setLedgers(data.ledgers || []);
    } catch (e: any) {
      const apiMsg =
        e?.response?.data?.message ||
        (e?.response?.status === 404
          ? 'API not found — restart the backend server to load outstanding-receivable routes.'
          : null);
      setError(apiMsg || e?.message || 'Failed to load outstanding receivable');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const asOfLabel = asOfDate
    ? `As of ${formatDate(asOfDate)} | All`
    : 'As of today | All';

  const renderLedger = ({ item }: { item: OutstandingLedgerSummary }) => (
    <TouchableOpacity
      style={styles.ledgerRow}
      onPress={() =>
        navigation.navigate('OutstandingLedgerDetail', { partyName: item.partyName })
      }
      activeOpacity={0.7}
    >
      <View style={styles.ledgerLeft}>
        <Text style={styles.ledgerName} numberOfLines={2}>
          {item.partyName}
        </Text>
        <Text style={styles.ledgerMeta}>Credit: ₹ 0/0 days</Text>
        <Text style={styles.ledgerMeta}>Avg. pay: —</Text>
      </View>
      <Text style={styles.ledgerAmount}>
        {formatCurrency(item.totalOutstanding)}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Outstanding Receivable</Text>
        <View style={styles.headerActions}>
          <Icon name="magnify" size={22} color="#fff" style={styles.headerIcon} />
          <Icon name="filter-variant" size={22} color="#fff" style={styles.headerIcon} />
        </View>
      </View>

      <View style={styles.summaryBlock}>
        <Text style={styles.totalAmount}>{formatCurrency(totalOutstanding)}</Text>
        <Text style={styles.asOfText}>{asOfLabel}</Text>
      </View>

      <View style={styles.tabRow}>
        <Text style={styles.tabActive}>Ledgers</Text>
        <Text style={styles.tabInactive}>Group</Text>
        <Icon name="chart-bar" size={20} color={PRIMARY} style={styles.tabChart} />
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
          data={ledgers}
          keyExtractor={(item) => item.partyName}
          renderItem={renderLedger}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              No outstanding data. Run sync from desktop-agent with Tally open.
            </Text>
          }
          contentContainerStyle={ledgers.length === 0 ? styles.emptyList : undefined}
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
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 4,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: { marginLeft: 12 },
  summaryBlock: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: 'center',
  },
  totalAmount: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  asOfText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 4,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tabActive: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY,
    borderBottomWidth: 2,
    borderBottomColor: PRIMARY,
    paddingBottom: 4,
    marginRight: 24,
  },
  tabInactive: { fontSize: 15, color: '#888' },
  tabChart: { marginLeft: 'auto' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  ledgerLeft: { flex: 1, paddingRight: 12 },
  ledgerName: { fontSize: 15, fontWeight: '500', color: '#222' },
  ledgerMeta: { fontSize: 12, color: '#888', marginTop: 4 },
  ledgerAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: AMOUNT_COLOR,
  },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', paddingHorizontal: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  errorBox: { padding: 24, alignItems: 'center' },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
});

export default OutstandingReceivableScreen;
