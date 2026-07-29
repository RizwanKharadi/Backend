/**
 * CategoryCard — compact category tile (name + item count) for the
 * Category Summary grid.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

interface CategoryCardProps {
  name: string;
  count: number;
  color: string;
  onPress?: () => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ name, count, color, onPress }) => (
  <TouchableOpacity
    style={[styles.card, shadows.card]}
    activeOpacity={0.85}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${name}, ${count} items`}
  >
    <View style={[styles.iconChip, { backgroundColor: hexToRgba(color, 0.14) }]}>
      <Icon name="shape-outline" size={18} color={color} />
    </View>
    <View style={styles.text}>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.count}>{count} items</Text>
    </View>
    <Icon name="chevron-right" size={18} color={colors.textTertiary} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  count: { color: colors.textSecondary, fontSize: fontSize.caption, marginTop: 1 },
});

export default React.memo(CategoryCard);
