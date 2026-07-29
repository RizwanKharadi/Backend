import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  Alert,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Text, FAB, ActivityIndicator } from 'react-native-paper';
import { useDispatch } from 'react-redux';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useRoute } from '@react-navigation/native';

import InventoryHeader from '../components/inventory/InventoryHeader';
import { dashboardColors } from '../components/dashboard/dashboardTheme';

import { AppDispatch } from '../store';
import { useInventory, useCompany } from '../store/hooks';
import {
  fetchInventoryItems,
  fetchInventoryStats,
  deleteItem,
  clearError,
  setFilters,
} from '../store/slices/inventorySlice';

import { MainTabScreenProps } from '../types/navigation';
import { InventoryItem } from '../types';
import { MDI } from '../utils/mdiIcons';

type StockFilter = 'all' | 'low' | 'out' | 'ok';

type Props = MainTabScreenProps<'Inventory'>;

const MIN_RELOAD_MS = 45_000;

const STOCK_FILTERS: { id: StockFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: 'In stock' },
  { id: 'low', label: 'Low stock' },
  { id: 'out', label: 'Out of stock' },
];

const InventoryScreen: React.FC<Props> = ({ navigation }) => {
  const parentNavigation = navigation.getParent();
  const dispatch = useDispatch<AppDispatch>();

  const { items, error, pagination, isLoading, stats, lastFetchedAt, statsFetchedAt } =
    useInventory();
  const { selectedCompany } = useCompany();

  const route = useRoute<any>();
  const initialFilter = route.params?.initialFilter as StockFilter | undefined;

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>(initialFilter ?? 'all');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitFilter = useRef(false);

  const stackNav = parentNavigation ?? navigation;

  const applyFilters = useCallback(
    (search: string, stock: StockFilter) => {
      dispatch(
        setFilters({
          search: search.trim() || undefined,
          lowStock: stock === 'low' ? true : undefined,
          outOfStock: stock === 'out' ? true : undefined,
        })
      );
    },
    [dispatch]
  );

  const loadItems = useCallback(
    async (refresh = true) => {
      if (!selectedCompany?.id) return;
      try {
        await dispatch(fetchInventoryItems({ refresh })).unwrap();
      } catch (e) {
        console.error('Failed to load items:', e);
      }
    },
    [dispatch, selectedCompany?.id]
  );

  const loadStats = useCallback(
    async (force = false) => {
      if (!selectedCompany?.id) return;
      const now = Date.now();
      if (!force && statsFetchedAt && now - statsFetchedAt < MIN_RELOAD_MS) {
        return;
      }
      try {
        await dispatch(fetchInventoryStats(selectedCompany.id)).unwrap();
      } catch {
        // Stats are optional; list still works
      }
    },
    [dispatch, selectedCompany?.id, statsFetchedAt]
  );

  useFocusEffect(
    useCallback(() => {
      if (!selectedCompany?.id) return;
      const now = Date.now();
      const listStale = !lastFetchedAt || now - lastFetchedAt > MIN_RELOAD_MS;
      if (listStale || items.length === 0) {
        loadItems(true);
      }
      loadStats(false);
    }, [selectedCompany?.id, lastFetchedAt, items.length, loadItems, loadStats])
  );

  // Apply an initial stock filter passed via route params
  // (from the Inventory Warehouse Overview tiles).
  useEffect(() => {
    if (didInitFilter.current || !selectedCompany?.id) return;
    didInitFilter.current = true;
    if (initialFilter && initialFilter !== 'all') {
      applyFilters('', initialFilter);
      loadItems(true);
    }
  }, [selectedCompany?.id, initialFilter, applyFilters, loadItems]);

  useEffect(() => {
    if (error) {
      Alert.alert('Error', error);
      dispatch(clearError());
    }
  }, [error, dispatch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    applyFilters(searchQuery, stockFilter);
    await Promise.all([loadItems(true), loadStats(true)]);
    setRefreshing(false);
  }, [applyFilters, searchQuery, stockFilter, loadItems, loadStats]);

  const handleLoadMore = useCallback(async () => {
    if (isLoading || refreshing || loadingMore || !pagination.hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      await dispatch(fetchInventoryItems({ page: pagination.page + 1 })).unwrap();
    } catch (e) {
      console.error('Failed to load more items:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [dispatch, isLoading, refreshing, loadingMore, pagination.hasMore, pagination.page]);

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      searchDebounceRef.current = setTimeout(() => {
        applyFilters(query, stockFilter);
        loadItems(true);
      }, 400);
    },
    [applyFilters, stockFilter, loadItems]
  );

  const handleStockFilter = useCallback(
    (filter: StockFilter) => {
      setStockFilter(filter);
      applyFilters(searchQuery, filter);
      loadItems(true);
    },
    [applyFilters, searchQuery, loadItems]
  );

  const displayItems = useMemo(() => {
    if (stockFilter === 'ok') {
      return items.filter(
        (i) => i.currentStock > 0 && i.currentStock > (i.reorderLevel || 0)
      );
    }
    return items;
  }, [items, stockFilter]);

  const handleItemPress = useCallback(
    (itemId: string) => {
      stackNav.navigate('ItemDetail', { itemId });
    },
    [stackNav]
  );

  const handleScanBarcode = useCallback(() => {
    stackNav.navigate('BarcodeScanner', {
      title: 'Scan item barcode',
      onScanned: async (barcode: string) => {
        try {
          const res = await inventoryService.getItemByBarcode(barcode);
          stackNav.navigate('ItemDetail', { itemId: res.data.id });
        } catch (e: any) {
          stackNav.navigate('CreateItem', { barcode });
        }
      },
    });
  }, [stackNav]);

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const getStockMeta = (item: InventoryItem) => {
    if (item.currentStock <= 0) {
      return { label: 'Out', color: dashboardColors.negative, icon: 'alert-circle' as const };
    }
    if (item.currentStock <= item.reorderLevel) {
      return { label: 'Low', color: dashboardColors.warning, icon: MDI.alert as const };
    }
    return { label: 'OK', color: dashboardColors.positive, icon: 'check-circle' as const };
  };

  const displayTotal = pagination.total || stats.total || items.length;

  const subtitle = selectedCompany?.name
    ? `${selectedCompany.name} · ${displayTotal} items`
    : `${displayTotal} items`;

  const renderItem = useCallback(
    ({ item }: { item: InventoryItem }) => {
      const meta = getStockMeta(item);
      return (
        <TouchableOpacity
          style={styles.itemCard}
          onPress={() => handleItemPress(item.id)}
          activeOpacity={0.75}
        >
          <View style={[styles.itemIconWrap, { backgroundColor: `${meta.color}18` }]}>
            <Icon name="package-variant" size={22} color={meta.color} />
          </View>
          <View style={styles.itemBody}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.itemMeta} numberOfLines={1}>
              {item.category} · {item.unit}
              {item.code ? ` · ${item.code}` : ''}
            </Text>
          </View>
          <View style={styles.itemRight}>
            <Text style={styles.itemStock}>
              {item.currentStock} {item.unit}
            </Text>
            <Text style={styles.itemRate}>{formatCurrency(item.rate)}</Text>
            <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
              <Icon name={meta.icon} size={12} color={meta.color} />
              <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
          <Icon name="chevron-right" size={20} color={dashboardColors.muted} />
        </TouchableOpacity>
      );
    },
    [handleItemPress]
  );

  const renderFooter = () => {
    if (!loadingMore) return <View style={styles.listFooter} />;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator animating size="small" color={dashboardColors.accent} />
        <Text style={styles.footerText}>Loading more…</Text>
      </View>
    );
  };

  const ListHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Icon name="package-variant-closed" size={20} color={dashboardColors.accent} />
            <Text style={styles.statValue}>{stats.total || displayTotal}</Text>
            <Text style={styles.statLabel}>Total items</Text>
          </View>
          <View style={styles.statCard}>
            <Icon name="alert" size={20} color={dashboardColors.warning} />
            <Text style={styles.statValue}>{stats.lowStock ?? 0}</Text>
            <Text style={styles.statLabel}>Low stock</Text>
          </View>
          <View style={styles.statCard}>
            <Icon name="currency-inr" size={20} color={dashboardColors.positive} />
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatCurrency(stats.totalValue ?? 0)}
            </Text>
            <Text style={styles.statLabel}>Stock value</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Icon name="magnify" size={20} color={dashboardColors.muted} style={styles.searchIcon} />
          <TextInput
            placeholder="Search by name or code…"
            placeholderTextColor={dashboardColors.muted}
            value={searchQuery}
            onChangeText={handleSearchChange}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length === 0 ? (
            <TouchableOpacity onPress={handleScanBarcode} hitSlop={8} style={styles.scanBtn}>
              <Icon name="barcode-scan" size={20} color={dashboardColors.muted} />
            </TouchableOpacity>
          ) : null}
          {searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                applyFilters('', stockFilter);
                loadItems(true);
              }}
              hitSlop={8}
            >
              <Icon name="close-circle" size={18} color={dashboardColors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Stock filters */}
        <View style={styles.chipRow}>
          {STOCK_FILTERS.map((f) => {
            const active = stockFilter === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => handleStockFilter(f.id)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.listHint}>
          Showing {displayItems.length} of {displayTotal}
          {pagination.hasMore ? ' · scroll for more' : ''}
        </Text>
      </View>
    ),
    [
      stats,
      displayTotal,
      displayItems.length,
      pagination.hasMore,
      searchQuery,
      stockFilter,
      handleSearchChange,
      handleStockFilter,
      applyFilters,
      loadItems,
    ]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyContainer}>
        {isLoading && items.length === 0 ? (
          <ActivityIndicator size="large" color={dashboardColors.accent} />
        ) : (
          <>
            <Icon name="package-variant-closed" size={56} color={dashboardColors.muted} />
            <Text style={styles.emptyTitle}>No items found</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery || stockFilter !== 'all'
                ? 'Try a different search or filter'
                : 'Sync from Tally or add your first item'}
            </Text>
          </>
        )}
      </View>
    ),
    [isLoading, displayItems.length, searchQuery, stockFilter]
  );

  return (
    <View style={styles.container}>
      <InventoryHeader
        subtitle={subtitle}
        onSyncPress={() => stackNav.navigate('Sync')}
      />

      <FlatList
        style={styles.list}
        data={displayItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={
          displayItems.length === 0 ? styles.listEmptyContent : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={dashboardColors.accent}
            colors={[dashboardColors.accent]}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={11}
        removeClippedSubviews
      />

      <FAB
        icon="plus"
        style={styles.fab}
        color="#fff"
        onPress={() => stackNav.navigate('CreateItem')}
        label="Add item"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  listEmptyContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  listHeader: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 6,
  },
  statLabel: {
    fontSize: 10,
    color: dashboardColors.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
    height: 48,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 0,
  },
  scanBtn: {
    marginRight: 6,
    padding: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: dashboardColors.cardBg,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: '#eff6ff',
    borderColor: dashboardColors.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.muted,
  },
  chipTextActive: {
    color: dashboardColors.accent,
  },
  listHint: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginBottom: 8,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  itemIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  itemMeta: {
    fontSize: 11,
    color: dashboardColors.muted,
    marginTop: 3,
  },
  itemRight: {
    alignItems: 'flex-end',
    marginRight: 4,
  },
  itemStock: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  itemRate: {
    fontSize: 11,
    color: dashboardColors.muted,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  listFooter: {
    height: 8,
  },
  footerLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 13,
    color: dashboardColors.muted,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: dashboardColors.muted,
    marginTop: 8,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: dashboardColors.accent,
  },
});

export default InventoryScreen;
