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
import { reportService, InactiveItemRow } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/formatters';
import InactiveDaysFilterModal, {
  InactiveDaysFilterId,
  inactiveFilterLabel,
} from '../../components/reports/InactiveDaysFilterModal';

const PRIMARY = '#1565C0';

const InactiveItemScreen = () => {
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterId, setFilterId] = useState<InactiveDaysFilterId>('30');
  const [customDays, setCustomDays] = useState<number | undefined>();
  const [filterVisible, setFilterVisible] = useState(false);
  const [summary, setSummary] = useState({
    inactiveCount: 0,
    totalItems: 0,
    percentOfTotal: 0,
    totalValue: 0,
  });
  const [rows, setRows] = useState<InactiveItemRow[]>([]);

  const load = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Select a company first.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getInactiveItems({
        companyId: selectedCompany.id,
        inactiveDays: filterId,
        customDays,
      });
      setSummary(res.data.summary);
      setRows(res.data.items || []);
    } catch (e: any) {
      setError(
        e?.response?.data?.message || e?.message || 'Failed to load inactive items'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, filterId, customDays]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const filterSubtitle = inactiveFilterLabel(filterId, customDays, 'item');

  const formatQty = (qty: number, unit: string) => {
    const n = Number(qty);
    const formatted = Number.isInteger(n)
      ? n.toLocaleString()
      : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return `Qty: ${formatted} ${unit || 'Nos'}`;
  };

  const renderRow = ({ item }: { item: InactiveItemRow }) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta}>{formatQty(item.quantity, item.unit)}</Text>
        <Text style={styles.rowMeta}>Amount: {formatCurrency(item.amount)}</Text>
      </View>
      <Text style={styles.rowDate}>
        {item.lastSaleDateDisplay ||
          (item.lastSaleDate ? formatDate(new Date(item.lastSaleDate)) : '—')}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Item</Text>
          <Text style={styles.headerSub}>{filterSubtitle}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setFilterVisible(true)}
          style={styles.headerBtn}
        >
          <Icon name="filter-variant" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.statsBar}>
        <Text style={styles.statText}>
          <Text style={styles.statBold}>{summary.inactiveCount}</Text> Items
        </Text>
        <Text style={styles.statText}>
          <Text style={styles.statBold}>{summary.percentOfTotal}%</Text> Of Total
        </Text>
        <Text style={styles.statText}>
          <Text style={styles.statBold}>{formatCurrency(summary.totalValue)}</Text>
        </Text>
      </View>

      <View style={styles.colHeader}>
        <Text style={styles.colLeft}>Name & Closing</Text>
        <Text style={styles.colRight}>Last Sale Date</Text>
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
          data={rows}
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
            <Text style={styles.empty}>No inactive items for this filter.</Text>
          }
        />
      )}

      <InactiveDaysFilterModal
        visible={filterVisible}
        selectedId={filterId}
        customDays={customDays ? String(customDays) : undefined}
        onClose={() => setFilterVisible(false)}
        onSelect={(id, days) => {
          setFilterId(id);
          setCustomDays(days);
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
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 4,
    backgroundColor: '#e8eef5',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statText: { fontSize: 12, color: '#333' },
  statBold: { fontWeight: '700', color: PRIMARY },
  colHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  colLeft: { fontSize: 12, color: '#888', fontWeight: '600' },
  colRight: { fontSize: 12, color: '#888', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowName: { fontSize: 15, fontWeight: '500', color: '#222' },
  rowMeta: { fontSize: 13, color: '#666', marginTop: 4 },
  rowDate: { fontSize: 14, color: '#555', minWidth: 88, textAlign: 'right' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', padding: 24 },
});

export default InactiveItemScreen;
