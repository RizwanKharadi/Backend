/**
 * The records saved in the cloud that Tally has not confirmed.
 *
 * Registers exclude these so app totals match Tally exactly. This screen is
 * where they live instead — without it a created voucher would simply vanish
 * from the user's view.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import Header from '../components/common/Header';
import { MainStackScreenProps } from '../types/navigation';
import { useCompany } from '../store/hooks';
import {
  tallyService,
  PendingSyncItem,
  PendingSyncSummary,
} from '../services/tallyService';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

type Props = MainStackScreenProps<'PendingSync'>;

const TYPE_LABEL: Record<string, string> = {
  voucher: 'Voucher',
  ledger: 'Ledger',
  'stock-item': 'Stock item',
};

const TYPE_ICON: Record<string, string> = {
  voucher: 'receipt',
  ledger: 'account-outline',
  'stock-item': 'cube-outline',
};

function formatWhen(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

const PendingSyncScreen: React.FC<Props> = ({ navigation }) => {
  const { selectedCompany } = useCompany();
  const [summary, setSummary] = useState<PendingSyncSummary | null>(null);
  const [rows, setRows] = useState<PendingSyncItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const companyId = selectedCompany?.id;
    if (!companyId) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [s, i] = await Promise.all([
        tallyService.getPendingSyncSummary(companyId),
        tallyService.getPendingSyncItems(companyId),
      ]);
      setSummary(s.data);
      setRows(i.data || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load pending records');
    } finally {
      setLoading(false);
    }
  }, [selectedCompany?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // The counts come from the records themselves; the list comes from the retry
  // queue. Records that failed before the queue existed show in the counts but
  // have no queue row to list, so say so rather than showing an empty list.
  const unlisted = Math.max(0, (summary?.total || 0) - rows.length);

  const renderItem = ({ item }: { item: PendingSyncItem }) => {
    const stuck = item.status === 'failed';
    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Icon
            name={TYPE_ICON[item.entityType] || 'file-outline'}
            size={18}
            color={colors.textSecondary}
          />
          <Text style={styles.cardTitle}>
            {TYPE_LABEL[item.entityType] || item.entityType}
          </Text>
          <View style={[styles.pill, stuck ? styles.pillStuck : styles.pillWaiting]}>
            <Text style={[styles.pillText, stuck ? styles.pillTextStuck : styles.pillTextWaiting]}>
              {stuck ? 'Needs attention' : 'Will retry'}
            </Text>
          </View>
        </View>
        {item.lastError ? <Text style={styles.err}>{item.lastError}</Text> : null}
        <Text style={styles.meta}>
          {item.attempts} attempt{item.attempts === 1 ? '' : 's'}
          {item.lastAttemptAt ? ` · last ${formatWhen(item.lastAttemptAt)}` : ''}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Header title="Waiting for Tally" showBack onBackPress={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />
          }
          ListHeaderComponent={
            <View>
              {error ? <Text style={styles.errorBox}>{error}</Text> : null}
              <Text style={styles.explainer}>
                These are saved in the cloud but are not in Tally yet, so they are left out of your
                registers and totals — that keeps the app's figures matching Tally. They move into
                the register on their own once Tally confirms them.
              </Text>
              {summary && summary.total > 0 ? (
                <View style={styles.countRow}>
                  <Text style={styles.countText}>
                    {summary.vouchers} vouchers · {summary.parties} ledgers · {summary.items} items
                  </Text>
                </View>
              ) : null}
              {unlisted > 0 ? (
                <Text style={styles.note}>
                  {unlisted} of these failed before automatic retry existed, so {unlisted > 1 ? 'they' : 'it'}{' '}
                  cannot be retried and {unlisted > 1 ? 'need' : 'needs'} to be created again.
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="check-circle-outline" size={44} color={colors.success} />
              <Text style={styles.emptyTitle}>Everything is in Tally</Text>
              <Text style={styles.emptyText}>
                Nothing is waiting to sync. Your app figures match Tally.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  listContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  explainer: {
    fontSize: fontSize.label,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  countRow: { marginBottom: spacing.sm },
  countText: {
    fontSize: fontSize.label,
    color: colors.textPrimary,
    fontWeight: fontWeight.semibold as '600',
  },
  note: {
    fontSize: fontSize.label,
    color: colors.danger,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  errorBox: {
    fontSize: fontSize.label,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: {
    flex: 1,
    marginLeft: spacing.xs,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold as '600',
    color: colors.textPrimary,
  },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillWaiting: { backgroundColor: '#FEF3C7' },
  pillStuck: { backgroundColor: '#FEE2E2' },
  pillText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold as '600' },
  pillTextWaiting: { color: '#92400E' },
  pillTextStuck: { color: '#991B1B' },
  err: { marginTop: spacing.xs, fontSize: fontSize.label, color: colors.textSecondary },
  meta: { marginTop: spacing.xs, fontSize: fontSize.caption, color: colors.textTertiary },
  emptyTitle: {
    marginTop: spacing.sm,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold as '700',
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: 4,
    fontSize: fontSize.label,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default PendingSyncScreen;
