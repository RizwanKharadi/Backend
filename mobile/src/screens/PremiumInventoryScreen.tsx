/**
 * PremiumInventoryScreen — TallyFin "Warehouse Command Center".
 *
 * Business-intelligence first, list last. All figures are LIVE:
 *  - Redux inventory stats (total / lowStock / outOfStock / totalValue)
 *  - inventoryService.getItems({ outOfStock | lowStock }) → Items Needing Attention
 *  - inventoryService.getCategories() → Category Summary
 *
 * Sections with no backing API (capital-locked %, fast/slow/dead movement,
 * PO counts, value trend) are intentionally omitted rather than faked.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import InventoryHeader from '../components/InventoryHeader';
import InventoryHeroPanel from '../components/InventoryHeroPanel';
import InventoryStatCard from '../components/InventoryStatCard';
import SectionHeader from '../components/SectionHeader';
import AttentionRow from '../components/AttentionRow';
import CategoryCard from '../components/CategoryCard';
import BottomNavigation from '../components/BottomNavigation';

import { colors, gradients } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { navItems } from '../data/dashboardMockData';
import { DashboardTab } from '../types/dashboard';
import { AttentionItemVM, CategoryVM } from '../types/inventory';

import { AppDispatch } from '../store';
import { useInventory, useCompany, useNotification } from '../store/hooks';
import { fetchInventoryStats } from '../store/slices/inventorySlice';
import { inventoryService } from '../services/inventoryService';
import { InventoryItem } from '../types';
import { formatIndianCompact, toLocalDateString } from '../utils/formatters';

const SCREEN_PADDING = spacing.md;
const MIN_RELOAD_MS = 45_000;

const TAB_ROUTE: Record<Exclude<DashboardTab, 'inventory'>, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  reports: 'Reports',
};

const CATEGORY_COLORS = [colors.info, colors.kpiPurple, colors.green, colors.warning];

const PremiumInventoryScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch<AppDispatch>();

  const { stats } = useInventory();
  const { selectedCompany } = useCompany();
  const { unreadCount } = useNotification();

  const [attention, setAttention] = useState<AttentionItemVM[]>([]);
  const [categories, setCategories] = useState<CategoryVM[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const lastLoadRef = useRef(0);
  const inFlightRef = useRef(false);
  const fabScale = useRef(new Animated.Value(1)).current;

  const load = useCallback(
    async (force: boolean) => {
      const companyId = selectedCompany?.id;
      if (!companyId) {
        setLoading(false);
        setLoaded(true);
        return;
      }
      const now = Date.now();
      if (!force && now - lastLoadRef.current < MIN_RELOAD_MS) return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      setLoading(true);
      dispatch(fetchInventoryStats(companyId));

      try {
        const [outRes, lowRes, catRes] = await Promise.allSettled([
          inventoryService.getItems({ companyId, outOfStock: true, limit: 10 }),
          inventoryService.getItems({ companyId, lowStock: true, limit: 10 }),
          inventoryService.getCategories(companyId),
        ]);

        const toVM = (i: InventoryItem, status: 'out' | 'low'): AttentionItemVM => ({
          id: i.id,
          name: i.name,
          code: (i as { code?: string }).code,
          unit: i.unit,
          currentStock: i.currentStock,
          reorderLevel: i.reorderLevel,
          status,
        });

        const outItems =
          outRes.status === 'fulfilled' ? (outRes.value.data || []).map((i) => toVM(i, 'out')) : [];
        const lowItemsRaw =
          lowRes.status === 'fulfilled' ? lowRes.value.data || [] : [];
        const outIds = new Set(outItems.map((i) => i.id));
        const lowItems = lowItemsRaw
          .filter((i) => !outIds.has(i.id))
          .map((i) => toVM(i, 'low'))
          .sort((a, b) => a.currentStock - b.currentStock);

        setAttention([...outItems, ...lowItems].slice(0, 5));

        if (catRes.status === 'fulfilled') {
          setCategories(
            [...(catRes.value.data || [])].sort((a, b) => b.count - a.count).slice(0, 6)
          );
        }
        lastLoadRef.current = Date.now();
      } finally {
        inFlightRef.current = false;
        setLoading(false);
        setLoaded(true);
      }
    },
    [dispatch, selectedCompany?.id]
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  // ---- Derive overview from live stats ----
  const total = stats.total || 0;
  const low = stats.lowStock || 0;
  const out = stats.outOfStock || 0;
  const inStock = Math.max(0, total - low - out);
  const pctOf = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}% of total` : '—');
  const healthPct = total > 0 ? inStock / total : 0;

  // ---- Navigation ----
  const goStack = useCallback(
    (route: string, params?: object) => {
      const parent = navigation.getParent?.();
      (parent ?? navigation).navigate(route, params);
    },
    [navigation]
  );

  const handleTabPress = useCallback(
    (key: DashboardTab) => {
      if (key === 'inventory') return;
      navigation.navigate(TAB_ROUTE[key as Exclude<DashboardTab, 'inventory'>]);
    },
    [navigation]
  );

  const overviewCards: Array<{
    kind: string;
    icon: string;
    color: string;
    value: string;
    label: string;
    subtitle: string;
    filter: 'all' | 'ok' | 'low' | 'out';
  }> = [
    { kind: 'total', icon: 'package-variant-closed', color: colors.info, value: String(total), label: 'Total Items', subtitle: 'All items', filter: 'all' },
    { kind: 'in', icon: 'check-circle-outline', color: colors.success, value: String(inStock), label: 'In Stock', subtitle: pctOf(inStock), filter: 'ok' },
    { kind: 'low', icon: 'alert-outline', color: colors.warning, value: String(low), label: 'Low Stock', subtitle: pctOf(low), filter: 'low' },
    { kind: 'out', icon: 'close-circle-outline', color: colors.danger, value: String(out), label: 'Out of Stock', subtitle: pctOf(out), filter: 'out' },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.green}
            colors={[colors.green]}
          />
        }
      >
        <InventoryHeader
          companyName={selectedCompany?.name || 'Select company'}
          dateLabel={`As of ${toLocalDateString(new Date())}`}
          unreadCount={unreadCount || 0}
          onCompanyPress={() => goStack('CompanySelection')}
          onNotificationsPress={() => goStack('Notifications')}
          onProfilePress={() => goStack('Profile')}
          onSettingsPress={() => goStack('Settings')}
        />

        <View style={styles.content}>
          <View style={styles.heroWrap}>
            <InventoryHeroPanel
              value={formatIndianCompact(stats.totalValue || 0)}
              itemsLabel={`Across ${total} items`}
              healthPct={healthPct}
              healthSubtitle={`${inStock} of ${total} in stock`}
            />
          </View>

          {!selectedCompany?.id ? (
            <View style={styles.hint}>
              <Text style={styles.hintText}>Select a company to see your inventory.</Text>
            </View>
          ) : loading && !loaded ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.green} />
            </View>
          ) : (
            <>
              {/* Warehouse overview — 2x2 grid */}
              <SectionHeader
                title="Warehouse Overview"
                icon="warehouse"
                accentColor={colors.navy}
                onViewAll={() => goStack('InventoryList')}
              />
              <View style={styles.grid}>
                {overviewCards.map((c) => (
                  <View key={c.kind} style={styles.gridCell}>
                    <InventoryStatCard
                      icon={c.icon}
                      color={c.color}
                      value={c.value}
                      label={c.label}
                      subtitle={c.subtitle}
                      onPress={() => goStack('InventoryList', { initialFilter: c.filter })}
                    />
                  </View>
                ))}
              </View>

              {/* Items needing attention */}
              {attention.length > 0 ? (
                <>
                  <View style={styles.sectionGap} />
                  <SectionHeader
                    title="Items Needing Attention"
                    icon="alert-decagram-outline"
                    accentColor={colors.danger}
                    onViewAll={() => goStack('InventoryList')}
                  />
                  {attention.map((item) => (
                    <AttentionRow
                      key={item.id}
                      item={item}
                      onPress={() => goStack('ItemDetail', { itemId: item.id })}
                    />
                  ))}
                </>
              ) : null}

              {/* Category summary */}
              {categories.length > 0 ? (
                <>
                  <View style={styles.sectionGap} />
                  <SectionHeader
                    title="Category Summary"
                    icon="shape-outline"
                    accentColor={colors.kpiPurple}
                    onViewAll={() => goStack('InventoryList')}
                  />
                  <View style={styles.catGrid}>
                    {categories.map((c, i) => (
                      <View key={c.name} style={styles.catCell}>
                        <CategoryCard
                          name={c.name}
                          count={c.count}
                          color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                          onPress={() => goStack('InventoryList')}
                        />
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

            </>
          )}
        </View>
      </ScrollView>

      {/* Center FAB → add item */}
      <Animated.View style={[styles.fabWrap, { bottom: insets.bottom + 40, transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => goStack('CreateItem')}
          onPressIn={() => Animated.spring(fabScale, { toValue: 0.92, useNativeDriver: true }).start()}
          onPressOut={() => Animated.spring(fabScale, { toValue: 1, friction: 4, useNativeDriver: true }).start()}
          accessibilityRole="button"
          accessibilityLabel="Add item"
        >
          <LinearGradient colors={gradients.fab} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fab, shadows.fab]}>
            <Icon name="plus" size={30} color={colors.white} />
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      <BottomNavigation items={navItems} active="inventory" onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: SCREEN_PADDING },
  heroWrap: { marginTop: -(spacing.xxxl + spacing.sm) },
  hint: {
    marginTop: spacing.lg,
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  hintText: { color: '#92400E', fontSize: fontSize.body, textAlign: 'center' },
  loadingBlock: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  sectionGap: { height: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: '50%', padding: spacing.xxs + 2 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  catCell: { width: '50%', padding: spacing.xxs + 2 },
  shortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    justifyContent: 'space-between',
  },
  allItemsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  allItemsText: { flex: 1, color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  // FAB
  fabWrap: { position: 'absolute', alignSelf: 'center', zIndex: 20 },
  fab: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.background,
  },
});

export default PremiumInventoryScreen;
