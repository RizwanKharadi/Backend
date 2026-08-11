import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCompany } from '../../store/hooks';
import { useTranslation } from 'react-i18next';
import {
  reportService,
  TopTenCategory,
  TopTenReportData,
  TopTenRow,
} from '../../services/reportService';
import {
  formatCurrency,
  formatDate,
  formatDateShortYear,
  formatQuantity,
  toLocalDateString,
} from '../../utils/formatters';

const PRIMARY = '#1565C0';

const CATEGORIES: { id: TopTenCategory; labelKey: string }[] = [
  // Keys, not text: module scope is out of reach of any hook.
  { id: 'customers', labelKey: 'reports.topTen.customers' },
  { id: 'suppliers', labelKey: 'reports.topTen.suppliers' },
  { id: 'items_sold_value', labelKey: 'reports.topTen.itemsSoldValue' },
  { id: 'items_purchased_value', labelKey: 'reports.topTen.itemsPurchasedValue' },
  { id: 'items_sold_qty', labelKey: 'reports.topTen.itemsSoldQty' },
  { id: 'items_purchased_qty', labelKey: 'reports.topTen.itemsPurchasedQty' },
];

const formatPeriodLabel = (start: Date, end: Date): string =>
  `${formatDateShortYear(start).toUpperCase()} to ${formatDateShortYear(end).toUpperCase()}`;

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const resolveFiscalYearRange = (company: any): { start: Date; end: Date } => {
  const now = startOfDay(new Date());
  const fyStart = company?.settings?.fiscalYearStart;
  if (fyStart) {
    const parsed = new Date(fyStart);
    if (!Number.isNaN(parsed.getTime())) {
      let start = startOfDay(new Date(now.getFullYear(), parsed.getMonth(), parsed.getDate()));
      if (start > now) start.setFullYear(start.getFullYear() - 1);
      const end = startOfDay(new Date(start));
      end.setFullYear(end.getFullYear() + 1);
      end.setDate(end.getDate() - 1);
      return { start, end: end > now ? now : end };
    }
  }
  return {
    start: startOfDay(new Date(now.getFullYear(), 3, 1)),
    end: now,
  };
};

const TopTenReportScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { selectedCompany } = useCompany();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TopTenReportData | null>(null);
  const [category, setCategory] = useState<TopTenCategory>('customers');
  const [menuVisible, setMenuVisible] = useState(false);
  const [periodModalVisible, setPeriodModalVisible] = useState(false);
  const [activePicker, setActivePicker] = useState<'from' | 'to' | null>(null);

  const initialRange = useMemo(
    () => resolveFiscalYearRange(selectedCompany),
    [selectedCompany]
  );
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [draftStart, setDraftStart] = useState(initialRange.start);
  const [draftEnd, setDraftEnd] = useState(initialRange.end);

  useEffect(() => {
    const range = resolveFiscalYearRange(selectedCompany);
    setStartDate(range.start);
    setEndDate(range.end);
    setDraftStart(range.start);
    setDraftEnd(range.end);
  }, [selectedCompany]);

  const openPeriodModal = () => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setActivePicker(null);
    setPeriodModalVisible(true);
  };

  const applyPeriodPreset = (preset: string) => {
    const now = startOfDay(new Date());
    let start = startOfDay(new Date(draftStart));
    let end = startOfDay(new Date(draftEnd));

    switch (preset) {
      case 'This Month':
        start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
        end = now;
        break;
      case 'Last Month':
        start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        end = startOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
        break;
      case 'This Year':
        start = startOfDay(new Date(now.getFullYear(), 0, 1));
        end = now;
        break;
      case 'Financial Year': {
        const range = resolveFiscalYearRange(selectedCompany);
        start = range.start;
        end = range.end;
        break;
      }
      default:
        return;
    }

    setDraftStart(start);
    setDraftEnd(end);
  };

  const applyPeriod = () => {
    const from = startOfDay(draftStart);
    const to = startOfDay(draftEnd);
    if (from.getTime() > to.getTime()) {
      Alert.alert(t('reports.invalidPeriod'), t('reports.invalidPeriodMessage'));
      return;
    }
    setStartDate(from);
    setEndDate(to);
    setPeriodModalVisible(false);
    setActivePicker(null);
  };

  const onDatePickerChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setActivePicker(null);
    }
    if (event.type === 'dismissed' || !date) {
      return;
    }
    const picked = startOfDay(date);
    if (activePicker === 'from') {
      setDraftStart(picked);
    } else if (activePicker === 'to') {
      setDraftEnd(picked);
    }
  };

  const load = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Select a company first.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      // Send calendar dates (YYYY-MM-DD) — the server resolves exact boundaries
      // against voucher storage (UTC midnight of the IST calendar date).
      const res = await reportService.getTop10Report({
        companyId: selectedCompany.id,
        startDate: toLocalDateString(startOfDay(startDate)),
        endDate: toLocalDateString(startOfDay(endDate)),
      });
      setData(res.data);
    } catch (e: any) {
      setError(
        e?.response?.data?.message || e?.message || 'Failed to load Top 10 report'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, startDate, endDate]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const activeRows: TopTenRow[] = useMemo(() => {
    if (!data) return [];
    switch (category) {
      case 'customers':
        return data.topCustomers;
      case 'suppliers':
        return data.topSuppliers;
      case 'items_sold_value':
        return data.itemsSoldByValue;
      case 'items_purchased_value':
        return data.itemsPurchasedByValue;
      case 'items_sold_qty':
        return data.itemsSoldByQty;
      case 'items_purchased_qty':
        return data.itemsPurchasedByQty;
      default:
        return [];
    }
  }, [data, category]);

  const headerTotal = useMemo(() => {
    if (!data) return 0;
    switch (category) {
      case 'customers':
        return data.summary.totalCustomerSales;
      case 'suppliers':
        return data.summary.totalSupplierPurchases;
      case 'items_sold_value':
        return data.summary.totalItemsSoldValue;
      case 'items_purchased_value':
        return data.summary.totalItemsPurchasedValue;
      case 'items_sold_qty':
        return data.summary.totalItemsSoldQty;
      case 'items_purchased_qty':
        return data.summary.totalItemsPurchasedQty;
      default:
        return 0;
    }
  }, [data, category]);

  const isQtyView =
    category === 'items_sold_qty' || category === 'items_purchased_qty';

  const categoryLabel =
    t(CATEGORIES.find((c) => c.id === category)?.labelKey ?? 'reports.topTen.title');

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const renderRow = ({ item }: { item: TopTenRow }) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rank}>{item.rank}</Text>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {isQtyView ? (
          <Text style={styles.rowValue}>{formatQuantity(item.quantity)}</Text>
        ) : (
          <Text style={styles.rowValue}>{formatCurrency(item.totalAmount)}</Text>
        )}
        {!isQtyView && item.transactionCount != null ? (
          <Text style={styles.rowMeta}>
            {item.transactionCount} {item.transactionCount === 1 ? 'bill' : 'bills'}
          </Text>
        ) : null}
        {isQtyView && item.totalAmount > 0 ? (
          <Text style={styles.rowMeta}>{formatCurrency(item.totalAmount)}</Text>
        ) : null}
      </View>
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
        <Text style={styles.headerTitle}>{t('reports.topTen.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={openPeriodModal} style={styles.headerIconBtn}>
            <Icon name="calendar-range" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.summaryBlock}>
        <View style={styles.summaryTopRow}>
          <View style={styles.summaryTextCol}>
            <Text style={styles.totalAmount}>
              {isQtyView
                ? formatQuantity(headerTotal)
                : formatCurrency(headerTotal)}
            </Text>
            <TouchableOpacity onPress={openPeriodModal}>
              <Text style={styles.periodText}>{formatPeriodLabel(startDate, endDate)}</Text>
            </TouchableOpacity>
            <Text style={styles.periodSubText}>
              From {formatDate(startDate)} · To {formatDate(endDate)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.categoryBtn}
            onPress={() => setMenuVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.categoryBtnText} numberOfLines={1}>
              {categoryLabel}
            </Text>
            <Icon name="chevron-down" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={activeRows}
          keyExtractor={(item) => `${category}-${item.rank}-${item.name}`}
          renderItem={renderRow}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text style={styles.colHeaderName}>{t('reports.name')}</Text>
              <Text style={styles.colHeaderValue}>{isQtyView ? 'Qty' : 'Amount'}</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {t('reports.noTopTenData')}
            </Text>
          }
          contentContainerStyle={activeRows.length === 0 ? styles.emptyList : undefined}
        />
      )}

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuVisible(false)}>
          <View style={styles.menuCard}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.menuItem, category === cat.id && styles.menuItemActive]}
                onPress={() => {
                  setCategory(cat.id);
                  setMenuVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.menuItemText,
                    category === cat.id && styles.menuItemTextActive,
                  ]}
                >
                  {t(cat.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={periodModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPeriodModalVisible(false)}
      >
        <Pressable
          style={styles.periodOverlay}
          onPress={() => setPeriodModalVisible(false)}
        >
          <Pressable style={styles.periodSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.periodSheetTitle}>{t('reports.selectPeriod')}</Text>

            <View style={styles.presetRow}>
              {['This Month', 'Last Month', 'This Year', 'Financial Year'].map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={styles.presetChip}
                  onPress={() => applyPeriodPreset(preset)}
                >
                  <Text style={styles.presetChipText}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setActivePicker('from')}
            >
              <Text style={styles.dateFieldLabel}>{t('reports.fromDate')}</Text>
              <Text style={styles.dateFieldValue}>{formatDate(draftStart)}</Text>
              <Icon name="calendar" size={22} color={PRIMARY} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setActivePicker('to')}
            >
              <Text style={styles.dateFieldLabel}>{t('reports.toDate')}</Text>
              <Text style={styles.dateFieldValue}>{formatDate(draftEnd)}</Text>
              <Icon name="calendar" size={22} color={PRIMARY} />
            </TouchableOpacity>

            {activePicker && (
              <DateTimePicker
                value={activePicker === 'from' ? draftStart : draftEnd}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onDatePickerChange}
              />
            )}

            <View style={styles.periodActions}>
              <TouchableOpacity
                style={styles.periodCancelBtn}
                onPress={() => {
                  setPeriodModalVisible(false);
                  setActivePicker(null);
                }}
              >
                <Text style={styles.periodCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.periodApplyBtn} onPress={applyPeriod}>
                <Text style={styles.periodApplyText}>{t('transactions.apply')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 4,
  },
  headerActions: { flexDirection: 'row' },
  headerIconBtn: { padding: 8 },
  summaryBlock: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  summaryTextCol: { flex: 1, paddingRight: 8 },
  totalAmount: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
  },
  periodText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    marginTop: 6,
  },
  periodSubText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginTop: 4,
  },
  categoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '48%',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  categoryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginRight: 2,
    flexShrink: 1,
  },
  listHeader: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  colHeaderName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#666' },
  colHeaderValue: { fontSize: 13, fontWeight: '600', color: '#666', minWidth: 100, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  rank: {
    width: 28,
    fontSize: 14,
    fontWeight: '700',
    color: PRIMARY,
    marginRight: 8,
  },
  rowName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#222' },
  rowRight: { alignItems: 'flex-end', minWidth: 100 },
  rowValue: { fontSize: 16, fontWeight: '600', color: '#8B4513' },
  rowMeta: { fontSize: 11, color: '#888', marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', paddingHorizontal: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  errorBox: { padding: 24, alignItems: 'center' },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuCard: {
    backgroundColor: PRIMARY,
    borderRadius: 4,
    minWidth: 280,
    maxWidth: '92%',
    overflow: 'hidden',
    elevation: 8,
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.2)',
  },
  menuItemActive: { backgroundColor: 'rgba(255,255,255,0.12)' },
  menuItemText: { color: 'rgba(255,255,255,0.95)', fontSize: 16 },
  menuItemTextActive: { fontWeight: '700', color: '#fff' },
  periodOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  periodSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 24,
  },
  periodSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e3f2fd',
    borderWidth: 1,
    borderColor: '#90caf9',
  },
  presetChipText: { fontSize: 12, fontWeight: '600', color: PRIMARY },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    marginBottom: 10,
  },
  dateFieldLabel: {
    fontSize: 12,
    color: '#64748b',
    width: 72,
  },
  dateFieldValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  periodActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  periodCancelBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  periodCancelText: { fontSize: 15, color: '#64748b', fontWeight: '600' },
  periodApplyBtn: {
    backgroundColor: PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  periodApplyText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default TopTenReportScreen;
