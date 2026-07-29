/**
 * BooksEntryCard — elegant glass card for ledger entries (Journal / Contra).
 * Visually distinct from the Money In/Out rail cards: wider, tinted glass with
 * the amount and a small sparkline side by side.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import Sparkline from './Sparkline';
import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { TxnTypeSummary } from '../types/transactions';
import { formatIndianCompact } from '../utils/formatters';

interface BooksEntryCardProps {
  summary: TxnTypeSummary;
  countSuffix: string;
  onPress?: () => void;
}

const BooksEntryCard: React.FC<BooksEntryCardProps> = ({
  summary,
  countSuffix,
  onPress,
}) => (
  <TouchableOpacity
    activeOpacity={0.88}
    onPress={onPress}
    style={[styles.card, shadows.card]}
    accessibilityRole="button"
    accessibilityLabel={`${summary.title}, ${formatIndianCompact(summary.amount)}`}
  >
    <View style={styles.headerRow}>
      <View style={[styles.iconChip, { backgroundColor: hexToRgba(summary.color, 0.14) }]}>
        <Icon name={summary.icon} size={18} color={summary.color} />
      </View>
      <View style={styles.headerText}>
        <Text style={styles.title}>{summary.title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {summary.subtitle}
        </Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </View>

    <View style={styles.bottomRow}>
      <View style={styles.flex}>
        <Text style={[styles.amount, { color: summary.color }]} numberOfLines={1}>
          {summary.amount > 0 ? formatIndianCompact(summary.amount) : '₹0'}
        </Text>
        <Text style={styles.count}>
          {summary.count} {countSuffix}
        </Text>
      </View>
      <View style={styles.sparkWrap}>
        <Sparkline
          values={summary.spark}
          color={summary.color}
          width={64}
          height={34}
          gradientId={`book-${summary.id}`}
        />
      </View>
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 132,
    justifyContent: 'space-between',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.caption, marginTop: 1 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  flex: { flex: 1 },
  amount: { fontSize: fontSize.title, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  count: { color: colors.textSecondary, fontSize: fontSize.caption, marginTop: 2, fontWeight: fontWeight.medium },
  sparkWrap: { width: 64 },
});

export default React.memo(BooksEntryCard);
