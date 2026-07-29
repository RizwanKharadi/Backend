/**
 * OutstandingList — "Top Outstanding" card. Numbered rows with party name,
 * amount and a status pill. Rows fade/slide in with a subtle stagger using
 * the built-in Animated API (no extra native deps).
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { OutstandingItem, OutstandingStatus } from '../types/dashboard';

const STATUS_STYLE: Record<OutstandingStatus, { label: string; color: string }> = {
  overdue: { label: 'Overdue', color: colors.danger },
  dueSoon: { label: 'Due Soon', color: colors.warning },
  paid: { label: 'Paid', color: colors.success },
};

interface RowProps {
  item: OutstandingItem;
  index: number;
  isLast: boolean;
  onPress?: () => void;
}

const Row: React.FC<RowProps> = ({ item, index, isLast, onPress }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const status = STATUS_STYLE[item.status];

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 280,
      delay: index * 45,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
        ],
      }}
    >
      <TouchableOpacity
        style={[styles.row, isLast && styles.rowLast]}
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${item.amount}, ${status.label}`}
      >
        <View style={styles.numBadge}>
          <Text style={styles.numText}>{String(index + 1).padStart(2, '0')}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.right}>
          <Text style={styles.amount}>{item.amount}</Text>
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

interface OutstandingListProps {
  title?: string;
  items: OutstandingItem[];
  onViewAll?: () => void;
  onItemPress?: (item: OutstandingItem) => void;
}

const OutstandingList: React.FC<OutstandingListProps> = ({
  title = 'Top Outstanding',
  items,
  onViewAll,
  onItemPress,
}) => (
  <View style={[styles.card, shadows.card]}>
    <View style={styles.header}>
      <Text style={styles.cardTitle}>{title}</Text>
      <TouchableOpacity onPress={onViewAll} activeOpacity={0.7} accessibilityRole="button">
        <Text style={styles.viewAll}>
          View all <Text style={styles.chev}>›</Text>
        </Text>
      </TouchableOpacity>
    </View>

    {items.map((item, i) => (
      <Row
        key={item.id}
        item={item}
        index={i}
        isLast={i === items.length - 1}
        onPress={() => onItemPress?.(item)}
      />
    ))}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
  viewAll: {
    color: colors.green,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
  },
  chev: { fontSize: fontSize.bodyLg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  numBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.numberBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
  },
  name: {
    flex: 1,
    color: '#1B2A47',
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  right: { alignItems: 'flex-end' },
  amount: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  status: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
});

export default React.memo(OutstandingList);
