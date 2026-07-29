export type TransactionGroup = 'inflow' | 'outflow' | 'ledger';

export interface TransactionTypeConfig {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  gradientEnd: string;
  group: TransactionGroup;
}

export const TRANSACTION_TYPES: TransactionTypeConfig[] = [
  {
    id: 'sales',
    title: 'Sales',
    subtitle: 'Invoices & sales',
    icon: 'cart-plus',
    color: '#10b981',
    gradientEnd: '#059669',
    group: 'inflow',
  },
  {
    id: 'receipt',
    title: 'Receipt',
    subtitle: 'Money received',
    icon: 'cash-plus',
    color: '#06b6d4',
    gradientEnd: '#0891b2',
    group: 'inflow',
  },
  {
    id: 'credit_note',
    title: 'Credit Note',
    subtitle: 'Credits issued',
    icon: 'note-plus-outline',
    color: '#6366f1',
    gradientEnd: '#4f46e5',
    group: 'inflow',
  },
  {
    id: 'purchase',
    title: 'Purchase',
    subtitle: 'Bills & purchases',
    icon: 'cart-outline',
    color: '#f59e0b',
    gradientEnd: '#d97706',
    group: 'outflow',
  },
  {
    id: 'payment',
    title: 'Payment',
    subtitle: 'Money paid out',
    icon: 'cash-minus',
    color: '#ef4444',
    gradientEnd: '#dc2626',
    group: 'outflow',
  },
  {
    id: 'debit_note',
    title: 'Debit Note',
    subtitle: 'Debits raised',
    icon: 'note-minus-outline',
    color: '#78716c',
    gradientEnd: '#57534e',
    group: 'outflow',
  },
  {
    id: 'journal',
    title: 'Journal',
    subtitle: 'Adjustments',
    icon: 'book-open-variant',
    color: '#8b5cf6',
    gradientEnd: '#7c3aed',
    group: 'ledger',
  },
  {
    id: 'contra',
    title: 'Contra',
    subtitle: 'Bank ↔ cash',
    icon: 'bank-transfer',
    color: '#64748b',
    gradientEnd: '#475569',
    group: 'ledger',
  },
];

export const TRANSACTION_GROUP_META: Record<
  TransactionGroup,
  { label: string; icon: string; color: string }
> = {
  inflow: {
    label: 'Money in',
    icon: 'arrow-down-bold-circle-outline',
    color: '#10b981',
  },
  outflow: {
    label: 'Money out',
    icon: 'arrow-up-bold-circle-outline',
    color: '#ef4444',
  },
  ledger: {
    label: 'Books & entries',
    icon: 'book-outline',
    color: '#8b5cf6',
  },
};

export function getTransactionTypeConfig(
  typeId: string
): TransactionTypeConfig | undefined {
  return TRANSACTION_TYPES.find((t) => t.id === typeId);
}
