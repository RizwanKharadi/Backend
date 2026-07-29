/**
 * InventoryStatCard — a large card in the 2x2 Warehouse Overview grid.
 * Shows an accent icon, a big count, a label and a percentage subtitle.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

interface InventoryStatCardProps {
  icon: string;
  color: string;
  value: string;
  label: string;
  subtitle: string;
  compact?: boolean;
  onPress?: () => void;
}

const InventoryStatCard: React.FC<InventoryStatCardProps> = ({
  icon,
  color,
  value,
  label,
  subtitle,
  compact,
  onPress,
}) => (
  <TouchableOpacity
    style={[styles.card, compact && styles.cardCompact, shadows.card]}
    activeOpacity={0.88}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${label}, ${value}, ${subtitle}`}
  >
    <View style={styles.topRow}>
      <View
        style={[
          styles.iconChip,
          compact && styles.iconChipCompact,
          { backgroundColor: hexToRgba(color, 0.14) },
        ]}
      >
        <Icon name={icon} size={compact ? 18 : 20} color={color} />
      </View>
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </View>
    <Text style={[styles.value, compact && styles.valueCompact]} numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Text>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.subtitle}>{subtitle}</Text>
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
    minHeight: 128,
  },
  cardCompact: {
    padding: spacing.sm,
    minHeight: 96,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipCompact: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
  },
  value: {
    color: colors.textPrimary,
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  valueCompact: {
    fontSize: fontSize.h3,
  },
  label: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.semibold, marginTop: 2 },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.caption, marginTop: 2 },
});

export default React.memo(InventoryStatCard);
