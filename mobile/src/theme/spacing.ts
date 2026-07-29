/**
 * TallyFin — spacing, radius and elevation tokens.
 * 4 / 8 dp rhythm for consistent vertical and component spacing.
 */
import { Platform, ViewStyle } from 'react-native';

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 40,
  pill: 999,
} as const;

/** Common hit-slop to keep small icon buttons at a 44pt touch target. */
export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;

type Shadow = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

/** Cross-platform elevation presets (iOS shadow + Android elevation). */
export const shadows: Record<'card' | 'cardStrong' | 'fab' | 'nav', Shadow> = {
  card: Platform.select({
    ios: {
      shadowColor: '#0B1B3B',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
    },
    android: { elevation: 4 },
    default: {},
  }) as Shadow,
  cardStrong: Platform.select({
    ios: {
      shadowColor: '#0B1B3B',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.14,
      shadowRadius: 30,
    },
    android: { elevation: 8 },
    default: {},
  }) as Shadow,
  fab: Platform.select({
    ios: {
      shadowColor: '#13A538',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.4,
      shadowRadius: 18,
    },
    android: { elevation: 12 },
    default: {},
  }) as Shadow,
  nav: Platform.select({
    ios: {
      shadowColor: '#0B1B3B',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.06,
      shadowRadius: 20,
    },
    android: { elevation: 16 },
    default: {},
  }) as Shadow,
};
