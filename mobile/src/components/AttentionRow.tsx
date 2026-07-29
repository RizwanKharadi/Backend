/**
 * AttentionRow — a critical item needing action (out of / low stock), with a
 * status-colored left border, alert icon and reorder info.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { AttentionItemVM } from '../types/inventory';

interface AttentionRowProps {
  item: AttentionItemVM;
  onPress?: () => void;
}

const AttentionRow: React.FC<AttentionRowProps> = ({ item, onPress }) => {
  const isOut = item.status === 'out';
  const color = isOut ? colors.danger : colors.warning;
  const badgeText = isOut ? 'Out of stock' : `${item.currentStock} ${item.unit} left`;

  return (
    <TouchableOpacity
      style={[styles.row, { borderLeftColor: color }, shadows.card]}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${badgeText}`}
    >
      <View style={[styles.iconChip, { backgroundColor: hexToRgba(color, 0.14) }]}>
        <Icon name={isOut ? 'close-circle-outline' : 'alert-outline'} size={20} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.code ? `${item.code} · ` : ''}Reorder level {item.reorderLevel}
        </Text>
      </View>
      <View style={[styles.badge, { backgroundColor: hexToRgba(color, 0.14) }]}>
        <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
          {badgeText}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: fontSize.caption, marginTop: 1 },
  badge: { paddingHorizontal: spacing.xs, paddingVertical: 4, borderRadius: radius.sm - 2 },
  badgeText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
});

export default React.memo(AttentionRow);
