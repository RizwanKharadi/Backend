/**
 * PremiumTransactionsScreen — TallyFin Transactions, wired to LIVE data.
 *
 * Pulls vouchers for the selected period (Today / This Week / This Month /
 * Custom) AND the previous equal-length period via voucherService.getVouchers,
 * then derives per-type amount / count / growth% / daily sparkline and the
 * Money In / Net / Money Out totals — all client-side from real vouchers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import TransactionHeader from '../components/TransactionHeader';
import DayBookCard from '../components/DayBookCard';
import SectionHeader from '../components/SectionHeader';
import TransactionCard from '../components/TransactionCard';
import BooksEntryCard from '../components/BooksEntryCard';
import TransactionStatsCard from '../components/TransactionStatsCard';
import PeriodFilterBar from '../components/PeriodFilterBar';
import PendingSyncBanner from '../components/PendingSyncBanner';
import FloatingVoucherButton from '../components/FloatingVoucherButton';
import BottomNavigation from '../components/BottomNavigation';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { navItems } from '../data/dashboardMockData';
import {
  TRANSACTION_TYPES,
  TRANSACTION_GROUP_META,
} from '../constants/transactionTypes';
import { DashboardTab } from '../types/dashboard';
import { TxnTotals, TxnTypeSummary } from '../types/transactions';

import { useCompany, useNotification } from '../store/hooks';
import { navigateToTab } from '../navigation/reportNavigation';
import { voucherService } from '../services/voucherService';
import { tallyService, PendingSyncSummary } from '../services/tallyService';
import { Voucher } from '../types';
import {
  formatIndianCompact,
  calcPercentChange,
  toLocalDateString,
} from '../utils/formatters';
import {
  getVoucherTotalAmount,
  matchesVoucherType,
  sumVoucherAmounts,
} from '../utils/voucherHelpers';
import {
  PeriodKey,
  DateRange,
  rangeFor,
  previousRange,
  daysList,
  rangeLabel,
} from '../utils/transactionPeriods';

const SCREEN_PADDING = spacing.md;
const MIN_RELOAD_MS = 45_000;

const TAB_ROUTE: Record<Exclude<DashboardTab, 'transactions'>, string> = {
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  reports: 'Reports',
};

function dayKey(v: Voucher): string {
  return (v.date || (v as { createdAt?: string }).createdAt || '').slice(0, 10);
}

function growthFor(amount: number, prev: number): { label: string; positive?: boolean } {
  const pct = calcPercentChange(amount, prev);
  if (pct === null) return { label: '0.0%' };
  return { label: `${Math.abs(pct).toFixed(1)}%`, positive: pct >= 0 };
}

const PremiumTransactionsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { selectedCompany } = useCompany();
  const { unreadCount } = useNotification();

  const [period, setPeriod] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState<DateRange | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [prevVouchers, setPrevVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingSync, setPendingSync] = useState<PendingSyncSummary | null>(null);

  // Custom range modal
  const [customOpen, setCustomOpen] = useState(false);
  const [tmpFrom, setTmpFrom] = useState<Date>(new Date());
  const [tmpTo, setTmpTo] = useState<Date>(new Date());
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const lastLoadRef = useRef(0);
  const inFlightRef = useRef(false);

  const range = useMemo(
    () => rangeFor(period, custom ?? undefined),
    [period, custom]
  );

  const load = useCallback(
    async (force: boolean, current: DateRange) => {
      const companyId = selectedCompany?.id;
      if (!companyId) {
        setVouchers([]);
        setPrevVouchers([]);
        setLoading(false);
        setLoaded(true);
        return;
      }
      const now = Date.now();
      if (!force && now - lastLoadRef.current < MIN_RELOAD_MS) return;
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      setLoading(true);
      const prev = previousRange(current);
      try {
        const [curRes, prevRes] = await Promise.allSettled([
          voucherService.getVouchers({
            companyId,
            fromDate: current.fromDate,
            toDate: current.toDate,
            limit: 500,
            page: 1,
          }),
          voucherService.getVouchers({
            companyId,
            fromDate: prev.fromDate,
            toDate: prev.toDate,
            limit: 500,
            page: 1,
          }),
        ]);
        setVouchers(curRes.status === 'fulfilled' ? curRes.value.data || [] : []);
        setPrevVouchers(prevRes.status === 'fulfilled' ? prevRes.value.data || [] : []);
        lastLoadRef.current = Date.now();

        // Best-effort: the banner is informational, so a failure here must not
        // disturb the register itself.
        tallyService
          .getPendingSyncSummary(companyId)
          .then((r) => setPendingSync(r.data))
          .catch(() => setPendingSync(null));
      } finally {
        inFlightRef.current = false;
        setLoading(false);
        setLoaded(true);
      }
    },
    [selectedCompany?.id]
  );

  // Reload when the filter (period / custom range) changes.
  useEffect(() => {
    load(true, range);
  }, [load, range]);

  // Light refresh on focus.
  useFocusEffect(
    useCallback(() => {
      load(false, range);
    }, [load, range])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true, range);
    setRefreshing(false);
  }, [load, range]);

  // ---- Derive view models from live vouchers ----

  const days = useMemo(() => daysList(range), [range]);

  const summaries = useMemo<Record<string, TxnTypeSummary>>(() => {
    const out: Record<string, TxnTypeSummary> = {};
    for (const cfg of TRANSACTION_TYPES) {
      const cur = vouchers.filter((v) => matchesVoucherType(v, cfg.id));
      const amount = sumVoucherAmounts(cur);
      const prevAmount = sumVoucherAmounts(
        prevVouchers.filter((v) => matchesVoucherType(v, cfg.id))
      );
      const growth = growthFor(amount, prevAmount);

      const byDay = new Map<string, number>();
      for (const v of cur) {
        const k = dayKey(v);
        byDay.set(k, (byDay.get(k) || 0) + getVoucherTotalAmount(v));
      }
      const spark = days.map((d) => byDay.get(d) || 0);

      out[cfg.id] = {
        id: cfg.id,
        title: cfg.title,
        subtitle: cfg.subtitle,
        icon: cfg.icon,
        color: cfg.color,
        group: cfg.group,
        amount,
        count: cur.length,
        growthLabel: growth.label,
        growthPositive: growth.positive,
        spark,
      };
    }
    return out;
  }, [vouchers, prevVouchers, days]);

  const inflow = TRANSACTION_TYPES.filter((t) => t.group === 'inflow').map((t) => summaries[t.id]);
  const outflow = TRANSACTION_TYPES.filter((t) => t.group === 'outflow').map((t) => summaries[t.id]);
  const ledger = TRANSACTION_TYPES.filter((t) => t.group === 'ledger').map((t) => summaries[t.id]);

  // Cash movement, not turnover: money actually received is Receipt, money
  // actually paid is Payment. Summing every inflow/outflow tile double-counts —
  // a Sales invoice and the Receipt settling it are the same rupees.
  const totals = useMemo<TxnTotals>(() => {
    const zero = { amount: 0, count: 0 };
    const pick = (id: string) => {
      const s = summaries[id];
      return s ? { amount: s.amount, count: s.count } : zero;
    };
    const moneyIn = pick('receipt');
    const moneyOut = pick('payment');
    const net = moneyIn.amount - moneyOut.amount;
    return { moneyIn, moneyOut, netAmount: net, netPositive: net >= 0 };
  }, [summaries]);

  const countSuffix =
    period === 'today'
      ? 'today'
      : period === 'week'
      ? 'this week'
      : period === 'month'
      ? 'this month'
      : 'in range';

  // ---- Navigation (same redirects as the existing transactions screen) ----

  const goStack = useCallback(
    (route: string, params?: object) => {
      const parent = navigation.getParent?.();
      (parent ?? navigation).navigate(route, params);
    },
    [navigation]
  );

  // Carry the currently selected period into the drill-down so it opens on the
  // same range the tiles were calculated from.
  const openType = useCallback(
    (s: TxnTypeSummary) =>
      goStack('FilteredVouchers', {
        voucherType: s.id,
        title: s.title,
        fromDate: range.fromDate,
        toDate: range.toDate,
      }),
    [goStack, range]
  );

  const handleTabPress = useCallback(
    (key: DashboardTab) => {
      if (key === 'transactions') return;
      navigateToTab(
        navigation as any,
        TAB_ROUTE[key as Exclude<DashboardTab, 'transactions'>]
      );
    },
    [navigation]
  );

  const handleVoucher = useCallback(() => goStack('CreateNewVoucher', {}), [goStack]);

  // ---- Custom range modal handlers ----

  const handleFilterChange = useCallback((key: PeriodKey) => {
    if (key === 'custom') {
      setTmpFrom(new Date());
      setTmpTo(new Date());
      setCustomOpen(true);
      return;
    }
    setPeriod(key);
  }, []);

  const applyCustom = useCallback(() => {
    const from = tmpFrom <= tmpTo ? tmpFrom : tmpTo;
    const to = tmpFrom <= tmpTo ? tmpTo : tmpFrom;
    setCustom({ fromDate: toLocalDateString(from), toDate: toLocalDateString(to) });
    setPeriod('custom');
    setCustomOpen(false);
  }, [tmpFrom, tmpTo]);

  const renderRow = (list: TxnTypeSummary[]) => (
    <View style={styles.cardRow}>
      {list.map((s) => (
        <TransactionCard
          key={s.id}
          summary={s}
          countSuffix={countSuffix}
          onPress={() => openType(s)}
        />
      ))}
    </View>
  );

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
        <TransactionHeader
          title="Transactions"
          companyName={selectedCompany?.name || 'Select company'}
          dateLabel={rangeLabel(period, range)}
          unreadCount={unreadCount || 0}
          onCompanyPress={() => goStack('CompanySelection')}
          onDatePress={() => handleFilterChange('custom')}
          onNotificationsPress={() => goStack('Notifications')}
          onProfilePress={() => goStack('Profile')}
          onSettingsPress={() => goStack('Settings')}
        />

        <View style={styles.content}>
          <View style={styles.dayBookWrap}>
            <DayBookCard onPress={() => goStack('DayBook', {})} />
          </View>

          {!selectedCompany?.id ? (
            <View style={styles.hint}>
              <Text style={styles.hintText}>
                Select a company to see your transactions.
              </Text>
            </View>
          ) : loading && !loaded ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.green} />
            </View>
          ) : (
            <>
              {/* Records not yet in Tally are excluded from these tiles so the
                  totals match Tally. Surface them here or they are invisible. */}
              <PendingSyncBanner
                summary={pendingSync}
                onPress={() => goStack('PendingSync')}
              />

              {/* Period filter sits above the tiles it controls — every amount
                  below is scoped to this range. */}
              <View style={styles.filterWrap}>
                <PeriodFilterBar active={period} onChange={handleFilterChange} />
              </View>

              <SectionHeader
                title="Sales Flow"
                icon={TRANSACTION_GROUP_META.inflow.icon}
                accentColor={colors.success}
                onViewAll={() => goStack('DayBook', {})}
              />
              {renderRow(inflow)}

              <View style={styles.sectionGap} />
              <SectionHeader
                title="Purchase Flow"
                icon={TRANSACTION_GROUP_META.outflow.icon}
                accentColor={colors.danger}
                onViewAll={() => goStack('DayBook', {})}
              />
              {renderRow(outflow)}

              <View style={styles.sectionGap} />
              <SectionHeader
                title="Books & Entries"
                icon={TRANSACTION_GROUP_META.ledger.icon}
                accentColor={colors.kpiPurple}
                onViewAll={() => goStack('DayBook', {})}
              />
              <View style={styles.booksRow}>
                {ledger.map((s) => (
                  <BooksEntryCard
                    key={s.id}
                    summary={s}
                    countSuffix={countSuffix}
                    onPress={() => openType(s)}
                  />
                ))}
              </View>

              <View style={styles.sectionGap} />
              <TransactionStatsCard totals={totals} />
            </>
          )}
        </View>
      </ScrollView>

      <FloatingVoucherButton
        onPress={handleVoucher}
        bottomOffset={insets.bottom + 40}
      />

      <BottomNavigation items={navItems} active="transactions" onTabPress={handleTabPress} />

      {/* Custom date range modal */}
      <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Custom date range</Text>

            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setShowFromPicker(true)}
              activeOpacity={0.8}
            >
              <Icon name="calendar-start" size={18} color={colors.navy} />
              <View style={styles.dateFieldText}>
                <Text style={styles.dateFieldLabel}>From</Text>
                <Text style={styles.dateFieldValue}>{toLocalDateString(tmpFrom)}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setShowToPicker(true)}
              activeOpacity={0.8}
            >
              <Icon name="calendar-end" size={18} color={colors.navy} />
              <View style={styles.dateFieldText}>
                <Text style={styles.dateFieldLabel}>To</Text>
                <Text style={styles.dateFieldValue}>{toLocalDateString(tmpTo)}</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setCustomOpen(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalApply]}
                onPress={applyCustom}
                activeOpacity={0.85}
              >
                <Text style={styles.modalApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {showFromPicker ? (
        <DateTimePicker
          value={tmpFrom}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(_, d) => {
            setShowFromPicker(false);
            if (d) setTmpFrom(d);
          }}
        />
      ) : null}
      {showToPicker ? (
        <DateTimePicker
          value={tmpTo}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(_, d) => {
            setShowToPicker(false);
            if (d) setTmpTo(d);
          }}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: SCREEN_PADDING },
  dayBookWrap: { marginTop: -(spacing.xxxl + spacing.sm) },
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
  cardRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  booksRow: { flexDirection: 'row', gap: spacing.sm },
  filterWrap: { marginTop: spacing.lg, marginBottom: spacing.md },
  // Custom modal
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(3, 9, 23, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.cardStrong,
  },
  modalTitle: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  dateFieldText: { flex: 1 },
  dateFieldLabel: { color: colors.textSecondary, fontSize: fontSize.caption },
  dateFieldValue: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  modalCancel: { backgroundColor: colors.background },
  modalCancelText: { color: colors.textSecondary, fontWeight: fontWeight.semibold },
  modalApply: { backgroundColor: colors.navy },
  modalApplyText: { color: colors.white, fontWeight: fontWeight.bold },
});

export default PremiumTransactionsScreen;
