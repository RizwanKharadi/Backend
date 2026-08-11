import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCompany } from '../../store/hooks';
import {
  reportService,
  OutstandingKind,
  OutstandingLedgerSummary,
} from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useTranslation } from 'react-i18next';

const PRIMARY = '#1565C0';
const AMOUNT_COLOR = '#8B4513';

// Receivable and payable are the same screen against a different Tally report.
const COPY: Record<OutstandingKind, { title: string; empty: string; error: string }> = {
  receivable: {
    title: 'Outstanding Receivable',
    empty: 'No outstanding receivable data. Run sync from desktop-agent with Tally open.',
    error: 'Failed to load outstanding receivable',
  },
  payable: {
    title: 'Outstanding Payable',
    empty: 'No outstanding payable data. Run sync from desktop-agent with Tally open.',
    error: 'Failed to load outstanding payable',
  },
};

const OutstandingReceivableScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const kind: OutstandingKind =
    (route.params as { kind?: OutstandingKind } | undefined)?.kind === 'payable'
      ? 'payable'
      : 'receivable';
  const copy = COPY[kind];
  const { selectedCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<OutstandingLedgerSummary[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const visibleLedgers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledgers;
    return ledgers.filter((l) => l.partyName.toLowerCase().includes(q));
  }, [ledgers, query]);

  // While filtering, the header total reflects what is on screen — showing the
  // full outstanding above a filtered list reads as a mismatch.
  const shownTotal = useMemo(
    () =>
      query.trim()
        ? visibleLedgers.reduce((s, l) => s + (l.totalOutstanding || 0), 0)
        : totalOutstanding,
    [query, visibleLedgers, totalOutstanding]
  );

  const load = useCallback(async () => {
    if (!selectedCompany?.id) {
      setError('Select a company first.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await reportService.getOutstanding(kind, selectedCompany.id);
      const data = res.data;
      setTotalOutstanding(data.totalOutstanding || 0);
      setAsOfDate(data.asOfDate || data.lastSyncedAt || null);
      setLedgers(data.ledgers || []);
    } catch (e: any) {
      const apiMsg =
        e?.response?.data?.message ||
        (e?.response?.status === 404
          ? `API not found — restart the backend server to load outstanding-${kind} routes.`
          : null);
      setError(apiMsg || e?.message || copy.error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCompany?.id, kind, copy.error]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const asOfLabel = asOfDate
    ? `As of ${formatDate(asOfDate)} | All`
    : 'As of today | All';

  const renderLedger = ({ item }: { item: OutstandingLedgerSummary }) => (
    <TouchableOpacity
      style={styles.ledgerRow}
      onPress={() =>
        navigation.navigate('OutstandingLedgerDetail', {
          partyName: item.partyName,
          kind,
        })
      }
      activeOpacity={0.7}
    >
      <View style={styles.ledgerLeft}>
        <Text style={styles.ledgerName} numberOfLines={2}>
          {item.partyName}
        </Text>
        <Text style={styles.ledgerMeta}>Credit: ₹ 0/0 days</Text>
        <Text style={styles.ledgerMeta}>Avg. pay: —</Text>
      </View>
      <Text style={styles.ledgerAmount}>
        {formatCurrency(item.totalOutstanding)}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{copy.title}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setSearchOpen((open) => !open)}
            style={styles.headerIconBtn}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Close search' : 'Search parties'}
          >
            <Icon name={searchOpen ? 'close' : 'magnify'} size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.summaryBlock}>
        <Text style={styles.totalAmount}>{formatCurrency(shownTotal)}</Text>
        <Text style={styles.asOfText}>{asOfLabel}</Text>
      </View>

      {searchOpen ? (
        <View style={styles.searchBar}>
          <Icon name="magnify" size={20} color="#888" />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('reports.searchParty')}
            placeholderTextColor="#9e9e9e"
            autoFocus
            returnKeyType="search"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
              <Icon name="close-circle" size={18} color="#bbb" />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.tabRow}>
        <Text style={styles.tabActive}>{t('reports.ledgers')}</Text>
        <Icon name="chart-bar" size={20} color={PRIMARY} style={styles.tabChart} />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visibleLedgers}
          keyExtractor={(item) => item.partyName}
          renderItem={renderLedger}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query.trim() ? `No party matching "${query.trim()}".` : copy.empty}
            </Text>
          }
          contentContainerStyle={
            visibleLedgers.length === 0 ? styles.emptyList : undefined
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: { padding: 8, marginLeft: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: -10,
    marginBottom: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 15,
    color: '#222',
  },
  summaryBlock: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: 'center',
  },
  totalAmount: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  asOfText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 4,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tabActive: {
    fontSize: 15,
    fontWeight: '600',
    color: PRIMARY,
    borderBottomWidth: 2,
    borderBottomColor: PRIMARY,
    paddingBottom: 4,
    marginRight: 24,
  },
  tabInactive: { fontSize: 15, color: '#888' },
  tabChart: { marginLeft: 'auto' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  ledgerLeft: { flex: 1, paddingRight: 12 },
  ledgerName: { fontSize: 15, fontWeight: '500', color: '#222' },
  ledgerMeta: { fontSize: 12, color: '#888', marginTop: 4 },
  ledgerAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: AMOUNT_COLOR,
  },
  empty: { textAlign: 'center', marginTop: 40, color: '#666', paddingHorizontal: 24 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  errorBox: { padding: 24, alignItems: 'center' },
  errorText: { color: '#c62828', textAlign: 'center' },
  retry: { color: PRIMARY, marginTop: 12, fontWeight: '600' },
});

export default OutstandingReceivableScreen;
