/**
 * TransactionCard — premium voucher-type card for the Money In / Money Out
 * rows. Compact and flexible so three cards sit side-by-side in one line.
 * Accent-colored, with amount, growth, a live sparkline and a count.
 * Scales slightly on press.
 */
import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import Sparkline from './Sparkline';
import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { TxnTypeSummary } from '../types/transactions';
import { formatCompactAmount } from '../utils/formatters';

interface TransactionCardProps {
  summary: TxnTypeSummary;
  countSuffix: string;
  onPress?: () => void;
}

const TransactionCard: React.FC<TransactionCardProps> = ({
  summary,
  countSuffix,
  onPress,
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const neutral = summary.growthPositive === undefined;
  const growthColor = neutral
    ? colors.textSecondary
    : summary.growthPositive
    ? colors.success
    : colors.danger;

  return (
    <Animated.View style={[styles.flex, { transform: [{ scale }] }, shadows.card]}>
      <Pressable
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start()
        }
        style={[styles.card, { borderTopColor: summary.color }]}
        accessibilityRole="button"
        accessibilityLabel={`${summary.title}, ${formatCompactAmount(summary.amount)}, ${summary.count} entries`}
      >
        <View style={[styles.iconChip, { backgroundColor: hexToRgba(summary.color, 0.14) }]}>
          <Icon name={summary.icon} size={20} color={summary.color} />
        </View>

        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
          {summary.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {summary.subtitle}
        </Text>

        <Text style={[styles.amount, { color: summary.color }]} numberOfLines={1} adjustsFontSizeToFit>
          {summary.amount > 0 ? formatCompactAmount(summary.amount) : '₹0'}
        </Text>

        <View style={styles.growthRow}>
          {neutral ? null : (
            <Icon
              name={summary.growthPositive ? 'menu-up' : 'menu-down'}
              size={14}
              color={growthColor}
            />
          )}
          <Text style={[styles.growth, { color: growthColor }]} numberOfLines={1}>
            {summary.growthLabel}
          </Text>
        </View>

        <View style={styles.spark}>
          <Sparkline
            values={summary.spark}
            color={summary.color}
            width={100}
            height={32}
            gradientId={`txn-${summary.id}`}
          />
        </View>

        <Text style={styles.count} numberOfLines={1}>
          {summary.count} {countSuffix}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.sm,
    borderTopWidth: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  subtitle: { color: colors.textSecondary, fontSize: 10, marginTop: 1 },
  amount: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  growthRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  growth: { fontSize: 10, fontWeight: fontWeight.medium },
  spark: { marginTop: spacing.xs },
  count: { color: colors.textSecondary, fontSize: 10, marginTop: spacing.xs, fontWeight: fontWeight.medium },
});

export default React.memo(TransactionCard);
