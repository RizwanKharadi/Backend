/**
 * TransactionStatsCard — premium summary strip with a gradient border and
 * three KPI blocks (Money In / Net Flow / Money Out). No donut chart.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, gradients } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { TxnTotals } from '../types/transactions';
import { formatIndianCompact } from '../utils/formatters';

interface TransactionStatsCardProps {
  totals: TxnTotals;
}

const Block: React.FC<{
  label: string;
  amount: string;
  sub: string;
  color: string;
  icon: string;
  align?: 'flex-start' | 'center' | 'flex-end';
}> = ({ label, amount, sub, color, icon, align = 'flex-start' }) => (
  <View style={[styles.block, { alignItems: align }]}>
    <View style={styles.labelRow}>
      <Icon name={icon} size={13} color={color} />
      <Text style={styles.label}>{label}</Text>
    </View>
    <Text style={[styles.amount, { color }]} numberOfLines={1} adjustsFontSizeToFit>
      {amount}
    </Text>
    <Text style={styles.sub}>{sub}</Text>
  </View>
);

const TransactionStatsCard: React.FC<TransactionStatsCardProps> = ({ totals }) => {
  const netSign = totals.netPositive ? '+' : '-';
  return (
    <LinearGradient
      colors={gradients.brand}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.border, shadows.card]}
    >
      <View style={styles.inner}>
        <Block
          label="Money In"
          amount={formatIndianCompact(totals.moneyIn.amount)}
          sub={`${totals.moneyIn.count} txns`}
          color={colors.success}
          icon="arrow-down-circle"
        />
        <View style={styles.divider} />
        <Block
          label="Net Flow"
          amount={`${netSign}${formatIndianCompact(Math.abs(totals.netAmount))}`}
          sub={totals.netPositive ? 'Surplus' : 'Deficit'}
          color={colors.info}
          icon="swap-vertical"
          align="center"
        />
        <View style={styles.divider} />
        <Block
          label="Money Out"
          amount={formatIndianCompact(totals.moneyOut.amount)}
          sub={`${totals.moneyOut.count} txns`}
          color={colors.danger}
          icon="arrow-up-circle"
          align="flex-end"
        />
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  border: { borderRadius: radius.xl, padding: 1.5 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.xl - 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  block: { flex: 1, gap: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { color: colors.textSecondary, fontSize: fontSize.caption, fontWeight: fontWeight.medium },
  amount: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  sub: { color: colors.textTertiary, fontSize: fontSize.caption },
  divider: { width: 1, height: 40, backgroundColor: colors.border, marginHorizontal: spacing.xs },
});

export default React.memo(TransactionStatsCard);
