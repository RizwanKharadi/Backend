/** Modern fintech dashboard palette */
export const dashboardColors = {
  headerTop: '#0f172a',
  headerBottom: '#1e40af',
  pageBg: '#f1f5f9',
  cardBg: '#ffffff',
  positive: '#10b981',
  negative: '#ef4444',
  warning: '#f59e0b',
  muted: '#64748b',
  headerText: '#f8fafc',
  headerTextMuted: '#94a3b8',
  accent: '#3b82f6',
};

export const voucherTypeColors: Record<string, string> = {
  sales: '#3b82f6',
  purchase: '#8b5cf6',
  payment: '#10b981',
  receipt: '#06b6d4',
  journal: '#64748b',
  contra: '#f59e0b',
  sales_order: '#6366f1',
  purchase_order: '#a855f7',
  receipt_note: '#14b8a6',
  delivery_note: '#0ea5e9',
  debit_note: '#f97316',
  credit_note: '#ec4899',
  default: '#94a3b8',
};

export function voucherTypeColor(type: string): string {
  const key = type.toLowerCase().replace(/\s+/g, '_');
  return voucherTypeColors[key] || voucherTypeColors.default;
}

/** Accent colors for dashboard metric cards */
export const metricAccentColors = {
  todaySales: '#3b82f6',
  monthlyRevenue: '#10b981',
  outstanding: '#f59e0b',
  bankBalance: '#6366f1',
  profit: '#14b8a6',
  topCustomer: '#8b5cf6',
  lowStock: '#ef4444',
};
