import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { reportService, FastMovingItemsData, FastMovingItemRow } from '../../services/reportService';
import ReportPeriodFilterModal, {
  ReportPeriodKey,
} from '../../components/reports/ReportPeriodFilterModal';
import { formatQuantity } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';

const PRIMARY = '#1565C0';

const formatQty = (qty: number) => formatQuantity(qty);

const FastMovingItemsScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>('this_year');
  const [periodModalVisible, setPeriodModalVisible] = useState(false);

  const [data, setData] = useState<FastMovingItemsData | null>(null);

  const load = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Select a company first.');
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const res = await reportService.getFastMovingItems({
        companyId: selectedCompany.id,
        periodKey,
      });
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load fast moving items');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, periodKey]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const items: FastMovingItemRow[] = useMemo(() => data?.items || [], [data]);
  const totalQtySold = data?.summary?.totalQtySold ?? 0;
  const periodLabel = data?.period?.label ?? '';

  const renderRow = ({ item }: { item: FastMovingItemRow }) => (
    <View style={styles.row}>
      <Text style={styles.rank}>{item.rank}</Text>
      <View style={styles.rowMid}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta}>Unit: {item.unit || 'Nos'}</Text>
      </View>
      <Text style={styles.qty}>
        {formatQty(item.qtySold)} {item.unit || 'Nos'}
      </Text>
    </View>
  );

  if (!selectedCompany) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{t('reports.selectCompany')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('reports.item.fastMoving.title')}</Text>
          <Text style={styles.headerSub}>{periodLabel ? `(${periodLabel})` : ''}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setPeriodModalVisible(true)}
          style={styles.headerBtn}
          accessibilityRole="button"
        >
          <Icon name="filter-variant" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.statsBar}>
        <Text style={styles.statText}>
          <Text style={styles.statBold}>{formatQty(totalQtySold)}</Text> {t('reports.qtySold')}
        </Text>
        <Text style={styles.statText}>
          <Text style={styles.statBold}>{items.length}</Text>{t('tally.entity.items')}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryWrap}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => `${item.rank}-${item.itemId ?? item.name}-${i}`}
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
            <View style={styles.colHeader}>
              <Text style={styles.colLeft}>{t('inventory.detail.item')}</Text>
              <Text style={styles.colRight}>{t('reports.qtySold')}</Text>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('reports.noDataForPeriod')}</Text>}
        />
      )}

      <ReportPeriodFilterModal
        visible={periodModalVisible}
        selectedKey={periodKey}
        onClose={() => setPeriodModalVisible(false)}
        onSelect={(key) => setPeriodKey(key)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: '#666', textAlign: 'center' },
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
    gap: 12,
  },
  rank: {
    width: 28,
    fontSize: 14,
    fontWeight: '700',
    color: PRIMARY,
  },
  rowMid: { flex: 1 },
  name: { fontSize: 15, fontWeight: '500', color: '#222' },
  meta: { fontSize: 12, color: '#666', marginTop: 3 },
  qty: { fontSize: 14, fontWeight: '700', color: '#8B4513', textAlign: 'right', minWidth: 120 },
  errorText: { color: '#c62828', textAlign: 'center' },
  retryWrap: { marginTop: 12 },
  retry: { color: PRIMARY, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', padding: 24 },
});

export default FastMovingItemsScreen;

