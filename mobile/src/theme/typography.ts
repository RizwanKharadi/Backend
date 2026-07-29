/**
 * TallyFin — typography tokens.
 * Uses the platform System font; weight + size scale tuned for a premium
 * fintech feel with tabular figures for money values.
 */
import { TextStyle } from 'react-native';
import { colors } from './colors';

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const fontSize = {
  caption: 11,
  label: 12,
  body: 14,
  bodyLg: 16,
  title: 18,
  h3: 21,
  h2: 26,
  display: 34,
} as const;

/** Reusable text presets. Spread into a Text style prop. */
export const typography: Record<string, TextStyle> = {
  display: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: fontSize.h3,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  bodyLg: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.regular,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  body: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  label: {
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: colors.textTertiary,
  },
  /** Money value — tabular figures so digits don't shift width. */
  money: {
    fontSize: fontSize.h3,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
};
