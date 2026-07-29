/**
 * TallyFin — color tokens (premium fintech 2026).
 * Single source of truth for brand, semantic, surface and chart colors.
 */

/** Convert #RRGGBB + alpha to an rgba() string. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const colors = {
  // Brand
  navy: '#032B6B',
  navyDeep: '#021E4D',
  navySoft: '#0A3A6E',
  green: '#13A538',
  greenBright: '#22C55E',

  // Surfaces
  background: '#F5F7FB',
  card: '#FFFFFF',
  border: '#ECEFF4',
  divider: '#F1F3F7',
  numberBadgeBg: '#EEF3FB',

  // Text
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9AA6B6',
  textOnDark: '#FFFFFF',
  textOnDarkMuted: 'rgba(255, 255, 255, 0.72)',

  // Semantic
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#2E86F0',

  // KPI accents
  kpiGreen: '#13A538',
  kpiOrange: '#F59E0B',
  kpiPurple: '#7C5CFC',
  kpiRed: '#EF4444',

  // Glass (over the gradient header / dark hero cards)
  glassFill: 'rgba(255, 255, 255, 0.12)',
  glassFillStrong: 'rgba(255, 255, 255, 0.18)',
  glassBorder: 'rgba(255, 255, 255, 0.22)',
  glassDivider: 'rgba(255, 255, 255, 0.12)',

  black: '#000000',
  white: '#FFFFFF',
} as const;

/** Gradients used across the app (start -> end). */
export const gradients = {
  brand: ['#032B6B', '#13A538'] as [string, string],
  header: ['#032B6B', '#0A3A6E', '#13A538'] as [string, string, string],
  heroNetWorth: ['#0E2E63', '#0A2349'] as [string, string],
  heroReceivables: ['#0E3357', '#0C2E3A'] as [string, string],
  fab: ['#13A538', '#032B6B'] as [string, string],
  salesChart: ['#2E86F0', '#13A538'] as [string, string],
} as const;

/** Per-quick-action gradient accents. */
export const actionGradients = {
  salesInvoice: ['#16B83E', '#0E7C2A'] as [string, string],
  receipt: ['#F8B53D', '#E08C0B'] as [string, string],
  payment: ['#8E7BFC', '#5A4AD1'] as [string, string],
  expense: ['#F87171', '#DC2626'] as [string, string],
} as const;

export type AppColors = typeof colors;
