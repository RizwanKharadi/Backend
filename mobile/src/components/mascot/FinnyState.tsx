/**
 * Finny fronting a whole-screen or in-card state message.
 *
 * One component for empty / error / success / working, so those four states
 * look like the same app rather than four different designers. Each variant
 * picks its own pose, animation and accent — callers supply only the words.
 */
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Button, Text } from 'react-native-paper';
import FinnyMascot, { type FinnyAnimation } from './FinnyMascot';
import type { FinnyPose, FinnySize } from './finnyPoses';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { fontSize, fontWeight } from '../../theme/typography';

export type FinnyStateVariant = 'empty' | 'error' | 'success' | 'working' | 'help';

interface VariantStyle {
  pose: FinnyPose;
  animation: FinnyAnimation;
  accent: string;
}

const VARIANTS: Record<FinnyStateVariant, VariantStyle> = {
  // Curious, not sad — "no rows yet" is a filter question, not a failure.
  empty: { pose: 'empty', animation: 'float', accent: colors.info },
  // Concerned but reassuring. The accent is the only red on screen.
  error: { pose: 'error', animation: 'float', accent: colors.danger },
  success: { pose: 'success', animation: 'celebrate', accent: colors.green },
  working: { pose: 'working', animation: 'float', accent: colors.info },
  help: { pose: 'help', animation: 'wave', accent: colors.navy },
};

interface FinnyStateProps {
  variant: FinnyStateVariant;
  title: string;
  message?: string;
  /** Primary action, e.g. "Try again". */
  actionLabel?: string;
  onAction?: () => void;
  size?: FinnySize;
  /** Renders inside a card instead of filling the screen. */
  compact?: boolean;
  style?: ViewStyle;
}

const FinnyState: React.FC<FinnyStateProps> = ({
  variant,
  title,
  message,
  actionLabel,
  onAction,
  size,
  compact = false,
  style,
}) => {
  const v = VARIANTS[variant];

  return (
    <View style={[compact ? styles.compact : styles.container, style]}>
      <FinnyMascot
        pose={v.pose}
        size={size ?? (compact ? 'sm' : 'lg')}
        animation={v.animation}
        decorative
      />
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {message ? (
        <Text style={[styles.message, compact && styles.messageCompact]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          mode="contained"
          onPress={onAction}
          style={styles.action}
          buttonColor={v.accent}
          compact={compact}
        >
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  compact: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  title: {
    marginTop: spacing.md,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: fontSize.body,
    marginTop: spacing.sm,
  },
  message: {
    marginTop: spacing.xs,
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  messageCompact: {
    fontSize: fontSize.caption,
  },
  action: {
    marginTop: spacing.lg,
    borderRadius: 12,
  },
});

export default FinnyState;
