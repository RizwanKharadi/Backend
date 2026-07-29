/**
 * ShortcutButton — icon tile used in the Inventory Shortcuts grid.
 */
import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, hexToRgba } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

interface ShortcutButtonProps {
  icon: string;
  label: string;
  color: string;
  onPress?: () => void;
}

const ShortcutButton: React.FC<ShortcutButtonProps> = ({ icon, label, color, onPress }) => (
  <TouchableOpacity
    style={styles.btn}
    activeOpacity={0.85}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <View style={[styles.chip, { backgroundColor: hexToRgba(color, 0.14) }]}>
      <Icon name={icon} size={22} color={color} />
    </View>
    <Text style={styles.label} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  btn: { alignItems: 'center', gap: spacing.xs, width: '31%' },
  chip: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { color: colors.textPrimary, fontSize: fontSize.caption, fontWeight: fontWeight.medium },
});

export default React.memo(ShortcutButton);
