import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  StatusBar,
} from 'react-native';
import { Text, ActivityIndicator, FAB } from 'react-native-paper';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TransactionVoucherCard from '../components/transactions/TransactionVoucherCard';
import VoucherListDateFilter, {
  DateRangeValue,
  startOfDay,
} from '../components/transactions/VoucherListDateFilter';
import { dashboardColors } from '../components/dashboard/dashboardTheme';
import { getTransactionTypeConfig } from '../constants/transactionTypes';
import { voucherService } from '../services/voucherService';
import { useCompany } from '../store/hooks';
import { MainStackParamList } from '../types/navigation';
import { Voucher } from '../types';
import {
  formatIndianCompact,
  parseLocalDateString,
  toLocalDateString,
} from '../utils/formatters';
import {
  filterVouchersInRange,
  matchesVoucherType,
  sumVoucherAmounts,
} from '../utils/voucherHelpers';

type RouteProps = RouteProp<MainStackParamList, 'FilteredVouchers'>;
type NavigationProp = NativeStackNavigationProp<MainStackParamList>;

function defaultDateRange(): DateRangeValue {
  const now = startOfDay(new Date());
  return {
    from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: now,
  };
}

/**
 * Open on the period the caller selected (Transactions tiles pass their current
 * range). Falls back to the current month only when opened without a range.
 */
function initialDateRange(fromDate?: string, toDate?: string): DateRangeValue {
  if (!fromDate || !toDate) return defaultDateRange();
  const from = parseLocalDateString(fromDate);
  const to = parseLocalDateString(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return defaultDateRange();
  }
  return { from: startOfDay(from), to: startOfDay(to) };
}

const PAGE_SIZE = 500;
/** Stop runaway paging; 20 pages is 10,000 vouchers. */
const MAX_PAGES = 20;

/**
 * Walk every page, not just the first.
 *
 * The period total is summed from what this screen holds, and it used to hold
 * one 500-row page. A month fits in that; a financial year does not, so the
 * FY total silently reported only the newest 500 vouchers — 76L against Tally's
 * 1.49Cr. Anything short of every row in the range gives a wrong total.
 */
async function fetchAllPages(
  params: Record<string, unknown>
): Promise<Voucher[]> {
  const out: Voucher[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await voucherService.getVouchers({ ...params, page });
    const batch = res.data || [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

const FilteredVouchersScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();
  const { voucherType, title, fromDate: paramFrom, toDate: paramTo } = route.params;
  const { selectedCompany } = useCompany();

  const typeConfig = getTransactionTypeConfig(voucherType);
  const accent = typeConfig?.color ?? dashboardColors.accent;
  const gradientEnd = typeConfig?.gradientEnd ?? accent;

  const [dateRange, setDateRange] = useState<DateRangeValue>(() =>
    initialDateRange(paramFrom, paramTo)
  );
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fromStr = useMemo(() => toLocalDateString(dateRange.from), [dateRange.from]);
  const toStr = useMemo(() => toLocalDateString(dateRange.to), [dateRange.to]);

  const loadVouchers = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Please select a company first.');
      setVouchers([]);
      return;
    }

    setError(null);
    try {
      const baseParams = {
        companyId: selectedCompany.id,
        fromDate: fromStr,
        toDate: toStr,
        limit: PAGE_SIZE,
        page: 1,
      };

      let docs: Voucher[] = [];
      const typed = await fetchAllPages({ ...baseParams, type: voucherType });
      docs = typed.filter((v) => matchesVoucherType(v, voucherType));

      if (docs.length === 0) {
        const all = await fetchAllPages(baseParams);
        docs = all.filter((v) => matchesVoucherType(v, voucherType));
      }

      if (docs.length === 0) {
        const wide = await fetchAllPages({
          companyId: selectedCompany.id,
          limit: PAGE_SIZE,
        });
        docs = filterVouchersInRange(wide, fromStr, toStr).filter((v) =>
          matchesVoucherType(v, voucherType)
        );
      }

      setVouchers(docs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load vouchers';
      setError(msg);
      setVouchers([]);
    }
  }, [selectedCompany?.id, fromStr, toStr, voucherType]);

  useEffect(() => {
    setLoading(true);
    loadVouchers().finally(() => setLoading(false));
  }, [loadVouchers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadVouchers();
    setRefreshing(false);
  };

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return vouchers;
    return vouchers.filter(
      (v) =>
        v.voucherNumber?.toLowerCase().includes(q) ||
        v.partyName?.toLowerCase().includes(q) ||
        v.narration?.toLowerCase().includes(q)
    );
  }, [vouchers, searchQuery]);

  const totalAmount = useMemo(
    () => sumVoucherAmounts(filteredList),
    [filteredList]
  );

  const periodLabel = `${fromStr} → ${toStr}`;

  const renderItem = ({ item }: { item: Voucher }) => (
    <TransactionVoucherCard
      voucher={item}
      accentColor={accent}
      onPress={() => navigation.navigate('VoucherDetail', { voucherId: item.id })}
    />
  );

  const listHeader = (
    <>
      <View style={[styles.hero, { backgroundColor: accent }]}>
        <View style={[styles.heroGlow, { backgroundColor: gradientEnd }]} />
        <View style={styles.heroTop}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroTitle}>{title}</Text>
            <Text style={styles.heroPeriod}>{periodLabel}</Text>
          </View>
          <View style={[styles.heroTypeIcon, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Icon name={typeConfig?.icon || 'receipt'} size={26} color="#fff" />
          </View>
        </View>
        <View style={styles.heroStats}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Period total</Text>
            <Text style={styles.statValue}>{formatIndianCompact(totalAmount)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Vouchers</Text>
            <Text style={styles.statValue}>{filteredList.length}</Text>
          </View>
        </View>
      </View>

      <VoucherListDateFilter
        value={dateRange}
        onChange={setDateRange}
        accentColor={accent}
      />

      <View style={styles.searchWrap}>
        <Icon name="magnify" size={22} color={dashboardColors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder={`Search ${title.toLowerCase()} by party or number…`}
          placeholderTextColor={dashboardColors.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Icon name="close-circle" size={20} color={dashboardColors.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {filteredList.length > 0 ? (
        <Text style={styles.listHint}>
          {filteredList.length} {title.toLowerCase()} record
          {filteredList.length === 1 ? '' : 's'} in selected period
        </Text>
      ) : null}
    </>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={accent} />

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={styles.loadingText}>Loading {title.toLowerCase()}…</Text>
        </View>
      ) : error ? (
        <View style={[styles.centered, { paddingTop: insets.top + 24 }]}>
          <TouchableOpacity style={styles.backBtnPlain} onPress={() => navigation.goBack()}>
            <Icon name="arrow-left" size={24} color="#0f172a" />
          </TouchableOpacity>
          <Icon name="alert-circle-outline" size={44} color={dashboardColors.negative} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: accent }]}
            onPress={loadVouchers}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 100 + insets.bottom },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={accent}
              colors={[accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: `${accent}15` }]}>
                <Icon
                  name={typeConfig?.icon || 'file-document-outline'}
                  size={40}
                  color={accent}
                />
              </View>
              <Text style={styles.emptyTitle}>No {title.toLowerCase()} in this period</Text>
              <Text style={styles.emptyBody}>
                {searchQuery
                  ? 'Try a different search term'
                  : `No ${title.toLowerCase()} vouchers between ${fromStr} and ${toStr}. Change the date range above.`}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: accent, bottom: 20 + insets.bottom }]}
        color="#fff"
        onPress={() =>
          navigation.navigate('CreateNewVoucher', { initialType: voucherType })
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  hero: {
    marginHorizontal: -16,
    marginBottom: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
  },
  heroGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.4,
    transform: [{ translateX: 50 }, { scale: 1.25 }],
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backBtnPlain: {
    alignSelf: 'flex-start',
    marginBottom: 16,
    padding: 4,
  },
  heroTitleBlock: {
    flex: 1,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  heroPeriod: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  heroTypeIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.14)',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 14,
    paddingVertical: 14,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
    minHeight: 50,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 12,
  },
  listHint: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginBottom: 10,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  loadingText: {
    color: dashboardColors.muted,
    fontSize: 14,
  },
  errorText: {
    color: dashboardColors.muted,
    textAlign: 'center',
    fontSize: 14,
  },
  retryBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  emptyBody: {
    fontSize: 14,
    color: dashboardColors.muted,
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 20,
  },
  fab: {
    position: 'absolute',
    right: 20,
  },
});

export default FilteredVouchersScreen;
