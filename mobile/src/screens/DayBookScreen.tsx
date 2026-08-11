import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import DetailScreenHeader from '../components/common/DetailScreenHeader';
import { apiClient } from '../services/apiClient';
import { offlineCacheService } from '../services/offlineCacheService';
import { store } from '../store';
import { useCompany } from '../store/hooks';
import { MainStackParamList } from '../types/navigation';
import { dashboardColors, voucherTypeColor } from '../components/dashboard/dashboardTheme';
import {
  toLocalDateString,
  parseLocalDateString,
  formatDate,
  formatWeekdayDayMonth,
  formatCurrencyAbs,
} from '../utils/formatters';
import { matchesVoucherType, isNonAccountingVoucherType } from '../utils/voucherHelpers';
import { Voucher } from '../types';
import { useTranslation } from 'react-i18next';
import { FinnyState } from '../components/mascot';

type RouteProps = RouteProp<MainStackParamList, 'DayBook'>;
type NavigationProp = NativeStackNavigationProp<MainStackParamList>;

interface DayBookEntry {
  id?: string;
  voucherId?: string;
  date: string;
  voucherType: string;
  tallyVoucherTypeParent?: string;
  voucherNumber: string;
  partyName: string;
  amount: number;
  /** 'none' = orders/notes, which have no debit or credit side. */
  type: 'debit' | 'credit' | 'none';
  narration?: string;
}

interface CashTotal {
  amount: number;
  count: number;
}

interface DayBookSummary {
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
  transactionCount: number;
  /** Cash movement — added by the server; absent on older backends. */
  moneyIn?: CashTotal;
  moneyOut?: CashTotal;
  netCash?: number;
}

const QUICK_RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 Days' },
  { id: 'month', label: '30 Days' },
] as const;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDisplayDate(d: Date) {
  return formatDate(d);
}

function formatEntryDate(iso: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseLocalDateString(iso) : new Date(iso);
  return formatWeekdayDayMonth(d);
}

function voucherTypeLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const DayBookScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { selectedCompany } = useCompany();

  const { fromDate: initialFromDate, toDate: initialToDate } = route.params || {};

  const [fromDate, setFromDate] = useState(() =>
    initialFromDate
      ? parseLocalDateString(String(initialFromDate))
      : startOfDay(new Date())
  );
  const [toDate, setToDate] = useState(() =>
    initialToDate
      ? parseLocalDateString(String(initialToDate))
      : startOfDay(new Date())
  );
  const [quickRange, setQuickRange] = useState<string>('today');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [entries, setEntries] = useState<DayBookEntry[]>([]);
  const [summary, setSummary] = useState<DayBookSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyQuickRange = useCallback((id: string) => {
    const end = startOfDay(new Date());
    const start = startOfDay(new Date());
    if (id === 'week') start.setDate(end.getDate() - 6);
    if (id === 'month') start.setDate(end.getDate() - 29);
    setQuickRange(id);
    setFromDate(start);
    setToDate(end);
  }, []);

  const loadDayBook = useCallback(async () => {
    const companyId =
      selectedCompany?.id || store.getState().company?.selectedCompany?.id;

    if (!companyId) {
      setError('Please select a company first');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const fromStr = toLocalDateString(fromDate);
      const toStr = toLocalDateString(toDate);

      const response = await apiClient.get('/reports/daybook', {
        params: {
          companyId,
          fromDate: fromStr,
          toDate: toStr,
        },
      });

      if (response.data?.success) {
        const entries = response.data.data.entries || [];
        const summaryData = response.data.data.summary || null;
        setEntries(entries);
        setSummary(summaryData);
        void offlineCacheService.saveDayBook(companyId, fromStr, toStr, entries, summaryData);
        setError(null);
      } else {
        setError(response.data?.message || 'Failed to load day book');
      }
    } catch (err: any) {
      const fromStr = toLocalDateString(fromDate);
      const toStr = toLocalDateString(toDate);
      const cached = await offlineCacheService.loadDayBook(companyId, fromStr, toStr);
      if (cached?.entries?.length) {
        setEntries(cached.entries as DayBookEntry[]);
        setSummary((cached.summary as DayBookSummary) || null);
        setError(null);
      } else {
        setError(
          err?.response?.data?.message || err?.message || 'Failed to load day book'
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromDate, toDate, selectedCompany?.id]);

  useEffect(() => {
    loadDayBook();
  }, [loadDayBook]);

  const groupedEntries = useMemo(() => {
    const map = new Map<string, DayBookEntry[]>();
    for (const e of entries) {
      const key = e.date || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const totals = summary || {
    totalDebit: entries.filter((e) => e.type === 'debit').reduce((s, e) => s + e.amount, 0),
    totalCredit: entries.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0),
    netBalance: 0,
    transactionCount: entries.length,
  };
  if (!summary) {
    totals.netBalance = totals.totalCredit - totals.totalDebit;
  }

  /**
   * Money in / out is cash that actually moved — Receipt and Payment only. A
   * Sales invoice and the Receipt settling it are the same rupees, so counting
   * both would double them. Prefer the server's figures; fall back to the same
   * sum over entries so this is right against an older backend and offline cache.
   */
  const cash = useMemo(() => {
    if (summary?.moneyIn && summary?.moneyOut) {
      return {
        moneyIn: summary.moneyIn,
        moneyOut: summary.moneyOut,
        net: summary.netCash ?? summary.moneyIn.amount - summary.moneyOut.amount,
      };
    }
    const tally = (kind: 'receipt' | 'payment') =>
      entries.reduce(
        (acc, e) => {
          if (!matchesVoucherType(e as unknown as Voucher, kind)) return acc;
          return { amount: acc.amount + e.amount, count: acc.count + 1 };
        },
        { amount: 0, count: 0 }
      );
    const moneyIn = tally('receipt');
    const moneyOut = tally('payment');
    return { moneyIn, moneyOut, net: moneyIn.amount - moneyOut.amount };
  }, [summary, entries]);

  return (
    <View style={styles.container}>
      <DetailScreenHeader
        title={t('reports.item.dayBook.title')}
        subtitle={selectedCompany?.name || 'All transactions'}
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadDayBook();
            }}
            tintColor={dashboardColors.accent}
          />
        }
      >
        {/* Summary hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Icon name="book-open-page-variant" size={28} color="#fff" />
            <Text style={styles.heroLabel}>{t('dayBook.netMovement')}</Text>
          </View>
          <Text
            style={[
              styles.heroAmount,
              { color: cash.net >= 0 ? '#6ee7b7' : '#fca5a5' },
            ]}
          >
            {cash.net >= 0 ? '+' : ''}
            {formatCurrencyAbs(cash.net)}
          </Text>
          <Text style={styles.heroSub}>
            {totals.transactionCount} transaction
            {totals.transactionCount === 1 ? '' : 's'} ·{' '}
            {formatDisplayDate(fromDate)} – {formatDisplayDate(toDate)}
          </Text>
          <View style={styles.heroRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('dayBook.moneyIn')}</Text>
              <Text style={[styles.heroStatValue, { color: '#6ee7b7' }]}>
                {formatCurrencyAbs(cash.moneyIn.amount)}
              </Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{t('dayBook.moneyOut')}</Text>
              <Text style={[styles.heroStatValue, { color: '#fca5a5' }]}>
                {formatCurrencyAbs(cash.moneyOut.amount)}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick range */}
        <View style={styles.quickRow}>
          {QUICK_RANGES.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.quickChip, quickRange === r.id && styles.quickChipActive]}
              onPress={() => applyQuickRange(r.id)}
            >
              <Text
                style={[
                  styles.quickChipText,
                  quickRange === r.id && styles.quickChipTextActive,
                ]}
              >
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date range card */}
        <View style={styles.dateCard}>
          <Text style={styles.sectionTitle}>{t('dayBook.dateRange')}</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowFromPicker(true)}
            >
              <Icon name="calendar-start" size={20} color={dashboardColors.accent} />
              <View>
                <Text style={styles.dateBtnLabel}>{t('transactions.from')}</Text>
                <Text style={styles.dateBtnValue}>{formatDisplayDate(fromDate)}</Text>
              </View>
            </TouchableOpacity>
            <Icon name="arrow-right" size={18} color={dashboardColors.muted} />
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => setShowToPicker(true)}
            >
              <Icon name="calendar-end" size={20} color={dashboardColors.accent} />
              <View>
                <Text style={styles.dateBtnLabel}>To</Text>
                <Text style={styles.dateBtnValue}>{formatDisplayDate(toDate)}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {loading && !refreshing ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={dashboardColors.accent} />
            <Text style={styles.loadingText}>Loading entries…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Icon name="alert-circle-outline" size={22} color={dashboardColors.negative} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!loading && !error && entries.length === 0 ? (
          <View style={styles.emptyBox}>
            {/* Finny replaces the old placeholder glyph — one visual language
                for empty states across the app. */}
            <FinnyState
              variant="empty"
              title={t('dayBook.noEntries')}
              message={t('dayBook.noEntriesHint')}
            />
          </View>
        ) : null}

        {groupedEntries.map(([dateKey, dayEntries]) => (
          <View key={dateKey} style={styles.dayGroup}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{formatEntryDate(dateKey)}</Text>
              <View style={styles.dayBadge}>
                <Text style={styles.dayBadgeText}>{dayEntries.length}</Text>
              </View>
            </View>
            {dayEntries.map((entry, index) => {
              const isCredit = entry.type === 'credit';
              const accent = voucherTypeColor(entry.voucherType);
              // Orders, quotations and notes move no money — no sign, no DR/CR,
              // and the voucher-type colour instead of inflow/outflow green/red.
              const neutral =
                entry.type === 'none' ||
                isNonAccountingVoucherType(entry.voucherType) ||
                isNonAccountingVoucherType(entry.tallyVoucherTypeParent);
              const voucherId = entry.voucherId || entry.id;
              return (
                <TouchableOpacity
                  key={voucherId || `${entry.voucherNumber}-${index}`}
                  style={styles.entryCard}
                  activeOpacity={0.7}
                  disabled={!voucherId}
                  onPress={() => {
                    if (voucherId) {
                      navigation.navigate('VoucherDetail', { voucherId });
                    }
                  }}
                >
                  <View style={[styles.entryStripe, { backgroundColor: accent }]} />
                  <View style={styles.entryBody}>
                    <View style={styles.entryTop}>
                      <View style={styles.entryLeft}>
                        <Text style={styles.voucherNo}>{entry.voucherNumber}</Text>
                        <View style={styles.typeRow}>
                          <View
                            style={[
                              styles.typePill,
                              { backgroundColor: `${accent}22` },
                            ]}
                          >
                            <Text style={[styles.typePillText, { color: accent }]}>
                              {voucherTypeLabel(entry.voucherType)}
                            </Text>
                          </View>
                          {neutral ? null : (
                            <View
                              style={[
                                styles.drCrPill,
                                {
                                  backgroundColor: isCredit
                                    ? '#d1fae5'
                                    : '#fee2e2',
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.drCrText,
                                  {
                                    color: isCredit
                                      ? dashboardColors.positive
                                      : dashboardColors.negative,
                                  },
                                ]}
                              >
                                {isCredit ? 'CR' : 'DR'}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <Text
                        style={[
                          styles.entryAmount,
                          {
                            color: neutral
                              ? accent
                              : isCredit
                              ? dashboardColors.positive
                              : dashboardColors.negative,
                          },
                        ]}
                      >
                        {neutral ? '' : isCredit ? '+' : '−'}
                        {formatCurrencyAbs(entry.amount)}
                      </Text>
                    </View>
                    <Text style={styles.partyName} numberOfLines={1}>
                      {entry.partyName}
                    </Text>
                    {entry.narration ? (
                      <Text style={styles.narration} numberOfLines={2}>
                        {entry.narration}
                      </Text>
                    ) : null}
                    {voucherId ? (
                      <View style={styles.tapHint}>
                        <Text style={styles.tapHintText}>{t('common.viewDetails')}</Text>
                        <Icon name="chevron-right" size={16} color={dashboardColors.muted} />
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <View style={styles.bottomPad} />
      </ScrollView>

      {showFromPicker ? (
        <DateTimePicker
          value={fromDate}
          mode="date"
          display="default"
          onChange={(_, d) => {
            setShowFromPicker(false);
            if (d) {
              setFromDate(startOfDay(d));
              setQuickRange('');
            }
          }}
          maximumDate={toDate}
        />
      ) : null}
      {showToPicker ? (
        <DateTimePicker
          value={toDate}
          mode="date"
          display="default"
          onChange={(_, d) => {
            setShowToPicker(false);
            if (d) {
              setToDate(startOfDay(d));
              setQuickRange('');
            }
          }}
          minimumDate={fromDate}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  scroll: {
    padding: 16,
    paddingTop: 8,
  },
  hero: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
    backgroundColor: dashboardColors.headerBottom,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  heroLabel: {
    color: dashboardColors.headerTextMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  heroAmount: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  heroSub: {
    color: dashboardColors.headerTextMuted,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 16,
  },
  heroRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 14,
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
  },
  heroStatLabel: {
    color: dashboardColors.headerTextMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  heroStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  heroDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginHorizontal: 8,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  quickChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: dashboardColors.cardBg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  quickChipActive: {
    backgroundColor: '#eff6ff',
    borderColor: dashboardColors.accent,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.muted,
  },
  quickChipTextActive: {
    color: dashboardColors.accent,
  },
  dateCard: {
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: dashboardColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
  },
  dateBtnLabel: {
    fontSize: 11,
    color: dashboardColors.muted,
  },
  dateBtnValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  loadingBox: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: dashboardColors.muted,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef2f2',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: dashboardColors.negative,
    fontSize: 14,
  },
  emptyBox: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginTop: 16,
  },
  emptySub: {
    fontSize: 14,
    color: dashboardColors.muted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  dayGroup: {
    marginBottom: 20,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  dayTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  dayBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  dayBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: dashboardColors.muted,
  },
  entryCard: {
    flexDirection: 'row',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 1 },
    }),
  },
  entryStripe: {
    width: 4,
  },
  entryBody: {
    flex: 1,
    padding: 14,
  },
  entryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  entryLeft: {
    flex: 1,
    marginRight: 8,
  },
  voucherNo: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  drCrPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  drCrText: {
    fontSize: 11,
    fontWeight: '700',
  },
  entryAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  partyName: {
    fontSize: 14,
    color: '#334155',
    marginTop: 8,
    fontWeight: '500',
  },
  narration: {
    fontSize: 12,
    color: dashboardColors.muted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 2,
  },
  tapHintText: {
    fontSize: 12,
    color: dashboardColors.muted,
    fontWeight: '500',
  },
  bottomPad: {
    height: 24,
  },
});

export default DayBookScreen;
