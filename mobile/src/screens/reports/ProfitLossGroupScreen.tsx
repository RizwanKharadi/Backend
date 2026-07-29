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
import { reportService, ProfitLossGroupLedger } from '../../services/reportService';
import { formatCurrency } from '../../utils/formatters';
import { ReportPeriodKey } from '../../components/reports/ReportPeriodFilterModal';

const PRIMARY = '#1565C0';

type RouteParams = {
  groupName: string;
  periodKey: ReportPeriodKey;
  groupAmount?: number;
  reportKind?: 'profit_loss' | 'balance_sheet';
};

const ProfitLossGroupScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { selectedCompany } = useCompany();
  const { groupName, periodKey, groupAmount, reportKind = 'profit_loss' } =
    (route.params || {}) as RouteParams;
  const isBalanceSheet = reportKind === 'balance_sheet';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<ProfitLossGroupLedger[]>([]);

  const load = useCallback(async () => {
    if (!selectedCompany?.id || !groupName) {
      setError('Missing company or group.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = isBalanceSheet
        ? await reportService.getBalanceSheetGroupLedgers({
            companyId: selectedCompany.id,
            periodKey: periodKey || 'this_month',
            groupName,
          })
        : await reportService.getProfitLossGroupLedgers({
            companyId: selectedCompany.id,
            periodKey: periodKey || 'this_month',
            groupName,
          });
      setLedgers(res.data.ledgers || []);
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          e?.message ||
          'Failed to load group ledgers. Re-run sync on desktop-agent.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, groupName, periodKey, isBalanceSheet]);

  useEffect(() => {
    load();
  }, [load]);

  const renderRow = ({ item }: { item: ProfitLossGroupLedger }) => {
    const label = item.displayName || item.name;
    const isSubgroup = Boolean(item.isGroup);

    return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => {
        if (isSubgroup) {
          navigation.push('ProfitLossGroup', {
            groupName: label,
            periodKey: periodKey || 'this_month',
            groupAmount: item.amount,
            reportKind,
          });
        } else {
          navigation.navigate('ProfitLossLedgerVouchers', {
            ledgerName: label,
            periodKey: periodKey || 'this_month',
            groupName,
            reportKind,
          });
        }
      }}
      activeOpacity={0.7}
    >
      <Text
        style={[styles.rowName, isSubgroup && styles.rowNameGroup]}
        numberOfLines={2}
      >
        {label}
      </Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowAmount}>{formatCurrency(item.amount)}</Text>
        <Icon name="chevron-right" size={20} color="#888" />
      </View>
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
            {groupName}
          </Text>
          {groupAmount != null ? (
            <Text style={styles.headerSub}>{formatCurrency(groupAmount)}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.colHeader}>
        <Text style={styles.colLeft}>Ledger</Text>
        <Text style={styles.colRight}>Amount</Text>
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
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 4 },
  colHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  colLeft: { fontSize: 12, color: '#888', fontWeight: '600' },
  colRight: { fontSize: 12, color: '#888', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowName: { flex: 1, fontSize: 15, color: '#222', paddingRight: 8 },
  rowNameGroup: { fontWeight: '700', color: '#111' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAmount: { fontSize: 15, fontWeight: '600', color: '#8B4513' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', padding: 24 },
});

export default ProfitLossGroupScreen;
