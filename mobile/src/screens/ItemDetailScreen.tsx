import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useDispatch } from 'react-redux';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import DetailScreenHeader from '../components/common/DetailScreenHeader';
import { dashboardColors } from '../components/dashboard/dashboardTheme';

import { AppDispatch } from '../store';
import { useInventory } from '../store/hooks';
import { fetchItemById, deleteItem } from '../store/slices/inventorySlice';
import { InventoryItem } from '../types';
import { MainStackScreenProps } from '../types/navigation';
import { MDI } from '../utils/mdiIcons';

type Props = MainStackScreenProps<'ItemDetail'>;

function getStockMeta(item: InventoryItem) {
  if (item.currentStock <= 0) {
    return { label: 'Out of stock', color: dashboardColors.negative, icon: 'alert-circle' as const };
  }
  if (item.currentStock <= (item.reorderLevel || 0)) {
    return { label: 'Low stock', color: dashboardColors.warning, icon: MDI.alert as const };
  }
  return { label: 'In stock', color: dashboardColors.positive, icon: 'check-circle' as const };
}

const ItemDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { itemId } = route.params;
  const dispatch = useDispatch<AppDispatch>();
  const { selectedItem, isLoading, error } = useInventory();
  const [isDeleting, setIsDeleting] = useState(false);

  const loadItemDetail = useCallback(async () => {
    try {
      await dispatch(fetchItemById(itemId)).unwrap();
    } catch {
      Alert.alert('Error', 'Failed to load item details');
    }
  }, [dispatch, itemId]);

  useEffect(() => {
    loadItemDetail();
  }, [loadItemDetail]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const stockValue = useMemo(() => {
    if (!selectedItem) return 0;
    return selectedItem.currentStock * (selectedItem.rate || 0);
  }, [selectedItem]);

  const handleEdit = () => {
    navigation.navigate('CreateItem', { type: 'edit', itemId });
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete item',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: confirmDelete },
      ]
    );
  };

  const confirmDelete = async () => {
    try {
      setIsDeleting(true);
      await dispatch(deleteItem(itemId)).unwrap();
      Alert.alert('Deleted', 'Item removed successfully', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to delete item');
    } finally {
      setIsDeleting(false);
    }
  };

  const headerActions = (
    <>
      <TouchableOpacity onPress={handleEdit} style={styles.headerIconBtn} hitSlop={8}>
        <Icon name="pencil-outline" size={20} color={dashboardColors.headerText} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleDelete}
        style={styles.headerIconBtn}
        hitSlop={8}
        disabled={isDeleting}
      >
        <Icon name="delete-outline" size={20} color={dashboardColors.negative} />
      </TouchableOpacity>
    </>
  );

  if (isLoading && !selectedItem) {
    return (
      <View style={styles.container}>
        <DetailScreenHeader title="Item" subtitle="Loading…" onBackPress={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={dashboardColors.accent} />
        </View>
      </View>
    );
  }

  if (error || !selectedItem) {
    return (
      <View style={styles.container}>
        <DetailScreenHeader title="Item" onBackPress={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Icon name="package-variant-remove" size={56} color={dashboardColors.muted} />
          <Text style={styles.emptyTitle}>Item not found</Text>
          <Text style={styles.emptyDesc}>{error || 'This item may have been removed.'}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.primaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const meta = getStockMeta(selectedItem);

  const stockUnit = selectedItem.tallyStock?.unit || selectedItem.unit;
  const stockBalances = selectedItem.tallyStock
    ? {
        openingBalance: selectedItem.tallyStock.openingBalance ?? 0,
        inwardQuantity: selectedItem.tallyStock.inwardQuantity ?? 0,
        outwardQuantity: selectedItem.tallyStock.outwardQuantity ?? 0,
        closingBalance: selectedItem.tallyStock.closingBalance ?? selectedItem.currentStock ?? 0,
      }
    : null;

  const infoRows: { icon: string; label: string; value: string }[] = [
    { icon: 'barcode', label: 'Item code', value: selectedItem.code || '—' },
    { icon: 'folder-outline', label: 'Category', value: selectedItem.category || '—' },
    { icon: 'ruler', label: 'Unit', value: selectedItem.unit || '—' },
    { icon: 'currency-inr', label: 'Selling rate', value: formatCurrency(selectedItem.rate || 0) },
    {
      icon: MDI.reorderLevel,
      label: 'Reorder level',
      value: `${selectedItem.reorderLevel ?? 0} ${selectedItem.unit}`,
    },
    ...(selectedItem.maxLevel != null
      ? [{ icon: 'arrow-up-bold', label: 'Max level', value: `${selectedItem.maxLevel} ${selectedItem.unit}` }]
      : []),
    ...(selectedItem.location
      ? [{ icon: 'map-marker-outline', label: 'Location', value: selectedItem.location }]
      : []),
    { icon: 'identifier', label: 'Item ID', value: itemId },
    ...(selectedItem.tallyId
      ? [{ icon: 'link-variant', label: 'Tally ID', value: selectedItem.tallyId }]
      : []),
    { icon: 'calendar-plus', label: 'Created', value: formatDate(selectedItem.createdAt) },
    { icon: MDI.calendarUpdated, label: 'Updated', value: formatDate(selectedItem.updatedAt) },
    ...(selectedItem.lastSyncedAt
      ? [{ icon: 'sync', label: 'Last synced', value: formatDate(selectedItem.lastSyncedAt) }]
      : []),
  ];

  return (
    <View style={styles.container}>
      <DetailScreenHeader
        title={selectedItem.name}
        subtitle={selectedItem.code ? `Code ${selectedItem.code}` : selectedItem.category}
        onBackPress={() => navigation.goBack()}
        rightSlot={headerActions}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Stock hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <View style={styles.heroTop}>
            <View style={[styles.heroIconWrap, { backgroundColor: `${meta.color}30` }]}>
              <Icon name="package-variant" size={32} color="#fff" />
            </View>
            <View style={[styles.statusPill, { backgroundColor: `${meta.color}35` }]}>
              <Icon name={meta.icon} size={14} color="#fff" />
              <Text style={styles.statusPillText}>{meta.label}</Text>
            </View>
          </View>
          <Text style={styles.heroStock}>
            {selectedItem.currentStock} <Text style={styles.heroUnit}>{selectedItem.unit}</Text>
          </Text>
          <Text style={styles.heroSub}>Current quantity on hand</Text>
          <View style={styles.heroMetrics}>
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricLabel}>Stock value</Text>
              <Text style={styles.heroMetricValue}>{formatCurrency(stockValue)}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroMetric}>
              <Text style={styles.heroMetricLabel}>Rate</Text>
              <Text style={styles.heroMetricValue}>{formatCurrency(selectedItem.rate || 0)}</Text>
            </View>
          </View>
        </View>

        {stockBalances ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Stock balances</Text>
            {[
              { label: 'Opening balance', value: stockBalances.openingBalance },
              { label: 'Inward quantity', value: stockBalances.inwardQuantity },
              { label: 'Outward quantity', value: stockBalances.outwardQuantity },
              { label: 'Closing balance', value: stockBalances.closingBalance },
            ].map((row) => (
              <View key={row.label} style={styles.stockRow}>
                <Text style={styles.stockLabel}>{row.label}</Text>
                <Text style={styles.stockValue}>
                  {row.value} {stockUnit}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {selectedItem.description ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Description</Text>
            <Text style={styles.descriptionText}>{selectedItem.description}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Details</Text>
          {infoRows.map((row, index) => (
            <View
              key={row.label}
              style={[styles.infoRow, index < infoRows.length - 1 && styles.infoRowBorder]}
            >
              <View style={styles.infoIconWrap}>
                <Icon name={row.icon} size={18} color={dashboardColors.accent} />
              </View>
              <View style={styles.infoBody}>
                <Text style={styles.infoLabel}>{row.label}</Text>
                <Text style={styles.infoValue} numberOfLines={2}>
                  {row.value}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.outlineBtn} onPress={handleEdit} activeOpacity={0.8}>
          <Icon name="pencil" size={18} color={dashboardColors.accent} />
          <Text style={styles.outlineBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryBtnBar}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 12,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 16,
  },
  emptyDesc: {
    fontSize: 14,
    color: dashboardColors.muted,
    marginTop: 8,
    textAlign: 'center',
  },
  headerIconBtn: {
    padding: 8,
    marginLeft: 4,
  },
  heroCard: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1e40af',
    marginBottom: 14,
    padding: 20,
  },
  heroGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#3b82f6',
    opacity: 0.35,
    transform: [{ translateX: 60 }, { scale: 1.3 }],
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  heroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  heroStock: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heroUnit: {
    fontSize: 18,
    fontWeight: '600',
    opacity: 0.85,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  heroMetrics: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: 14,
  },
  heroMetric: {
    flex: 1,
    alignItems: 'center',
  },
  heroDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginHorizontal: 8,
  },
  heroMetricLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  heroMetricValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  card: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 12,
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  stockLabel: {
    fontSize: 13,
    color: '#475569',
  },
  stockValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  descriptionText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 22,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  infoRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoBody: {
    flex: 1,
    minWidth: 0,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginTop: 2,
  },
  bottomSpacer: {
    height: 100,
  },
  actionBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: dashboardColors.cardBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 8 },
    }),
  },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: dashboardColors.accent,
  },
  outlineBtnText: {
    color: dashboardColors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: dashboardColors.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryBtnBar: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: dashboardColors.accent,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default ItemDetailScreen;
