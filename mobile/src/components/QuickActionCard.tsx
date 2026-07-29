/**
 * QuickActionCard — a single large quick-action tile with a gradient accent
 * icon chip and a title. Used in a 4-up row (Sales Invoice / Receipt /
 * Payment / Expense).
 */
import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { QuickAction } from '../types/dashboard';

interface QuickActionCardProps {
  action: QuickAction;
  onPress?: () => void;
}

const QuickActionCard: React.FC<QuickActionCardProps> = ({ action, onPress }) => (
  <TouchableOpacity
    style={styles.card}
    activeOpacity={0.85}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={action.title}
  >
    <LinearGradient
      colors={action.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.chip, shadows.card]}
    >
      <Icon name={action.icon} size={22} color={colors.white} />
    </LinearGradient>
    <Text style={styles.title} numberOfLines={2}>
      {action.title}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  chip: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    lineHeight: 14,
  },
});

export default React.memo(QuickActionCard);
