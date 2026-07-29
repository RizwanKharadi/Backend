import type { Voucher, VoucherType } from '../types';

export type ItemVoucherType = 'sales' | 'purchase' | 'sales_order' | 'purchase_order';
export type MoneyVoucherType = 'receipt' | 'payment';

export interface VoucherTypePickerOption {
  id: string;
  label: string;
  subtitle: string;
  icon: string;
  color: string;
  needsParty: boolean;
  route:
    | 'item'
    | 'money'
    | 'journal'
    | 'generic';
}

export const VOUCHER_TYPE_PICKER: VoucherTypePickerOption[] = [
  {
    id: 'sales',
    label: 'Sales Invoice',
    subtitle: 'Items + GST · syncs to Tally',
    icon: 'cart-arrow-up',
    color: '#1565C0',
    needsParty: true,
    route: 'item',
  },
  {
    id: 'purchase',
    label: 'Purchase Invoice',
    subtitle: 'Supplier invoice · syncs to Tally',
    icon: 'cart-arrow-down',
    color: '#6A1B9A',
    needsParty: true,
    route: 'item',
  },
  {
    id: 'sales_order',
    label: 'Sales Order',
    subtitle: 'Order before billing · syncs to Tally',
    icon: 'clipboard-list-outline',
    color: '#3949AB',
    needsParty: true,
    route: 'item',
  },
  {
    id: 'purchase_order',
    label: 'Purchase Order',
    subtitle: 'Supplier order · syncs to Tally',
    icon: 'clipboard-text-outline',
    color: '#5D4037',
    needsParty: true,
    route: 'item',
  },
  {
    id: 'receipt',
    label: 'Receipt',
    subtitle: 'Money received · syncs to Tally',
    icon: 'cash-plus',
    color: '#2E7D32',
    needsParty: true,
    route: 'money',
  },
  {
    id: 'payment',
    label: 'Payment',
    subtitle: 'Pay party · syncs to Tally',
    icon: 'cash-minus',
    color: '#C62828',
    needsParty: true,
    route: 'money',
  },
  {
    id: 'journal',
    label: 'Journal',
    subtitle: 'Debit & credit · syncs to Tally',
    icon: 'book-open-variant',
    color: '#455A64',
    needsParty: false,
    route: 'journal',
  },
];

export interface ItemVoucherConfig {
  voucherType: ItemVoucherType;
  screenTitle: string;
  partyFieldLabel: string;
  accountLedgerLabel: string;
  defaultAccountLedger: string;
  defaultTallyVoucherType: string;
  tallyPush: boolean;
  addItemLabel: string;
}

const ITEM_CONFIGS: Record<ItemVoucherType, ItemVoucherConfig> = {
  sales: {
    voucherType: 'sales',
    screenTitle: 'Sales Invoice',
    partyFieldLabel: 'Party',
    accountLedgerLabel: 'Sales Account Ledger',
    defaultAccountLedger: 'Sales GST',
    defaultTallyVoucherType: 'Sales GST (26-27)',
    tallyPush: true,
    addItemLabel: 'ADD ITEMS',
  },
  purchase: {
    voucherType: 'purchase',
    screenTitle: 'Purchase Invoice',
    partyFieldLabel: 'Supplier',
    accountLedgerLabel: 'Purchase Account Ledger',
    defaultAccountLedger: 'Purchase',
    defaultTallyVoucherType: 'Purchase',
    tallyPush: true,
    addItemLabel: 'ADD ITEMS',
  },
  sales_order: {
    voucherType: 'sales_order',
    screenTitle: 'Sales Order',
    partyFieldLabel: 'Party',
    accountLedgerLabel: 'Sales Account Ledger',
    defaultAccountLedger: 'Sales GST',
    defaultTallyVoucherType: 'Sales Order',
    tallyPush: true,
    addItemLabel: 'ADD ITEMS',
  },
  purchase_order: {
    voucherType: 'purchase_order',
    screenTitle: 'Purchase Order',
    partyFieldLabel: 'Supplier',
    accountLedgerLabel: 'Purchase Account Ledger',
    defaultAccountLedger: 'Purchase',
    defaultTallyVoucherType: 'Purchase Order',
    tallyPush: true,
    addItemLabel: 'ADD ITEMS',
  },
};

export function getItemVoucherConfig(type: ItemVoucherType): ItemVoucherConfig {
  return ITEM_CONFIGS[type];
}

export function isItemVoucherType(type: string): type is ItemVoucherType {
  return type in ITEM_CONFIGS;
}

export function isMoneyVoucherType(type: string): type is MoneyVoucherType {
  return type === 'receipt' || type === 'payment';
}

export const DEFAULT_BANK_CASH_LEDGERS = [
  'Cash',
  'J & K BANK A/C',
  'Punjab National Bank',
  'HDFC Bank Ltd New A/c',
  'DBS Bank',
  'H.D.F.C Bank',
  'Kotak Mahindra Bank Ltd.',
];

export const PAYMENT_MODES = [
  'Cash',
  'Cheque',
  'NEFT',
  'RTGS',
  'UPI',
  'Card',
  'DD',
  'Other',
];

/** No type filter — show all synced parties (customers + suppliers) for trading vouchers. */
export function partyTypeForVoucher(_voucherType: string): undefined {
  return undefined;
}

/** Tally parent group for sales / purchase account ledger pickers */
export function accountLedgerParentForVoucher(voucherType: string): string {
  if (['sales', 'sales_order'].includes(voucherType)) return 'Sales Account';
  if (['purchase', 'purchase_order'].includes(voucherType)) return 'Purchase Account';
  return '';
}

/** Tally voucher type PARENT values to show per FinSync voucher slug */
export function tallyVoucherTypeParentsFor(voucherType: string): string[] {
  if (['sales', 'sales_order'].includes(voucherType)) return ['Sales', 'Sales Order'];
  if (['purchase', 'purchase_order'].includes(voucherType)) return ['Purchase', 'Purchase Order'];
  return [];
}

export function voucherTypeLabel(type: VoucherType | string): string {
  const found = VOUCHER_TYPE_PICKER.find((o) => o.id === type);
  return found?.label || type;
}

/** Voucher types that can be pushed to Tally via desktop agent */
export const TALLY_PUSH_VOUCHER_TYPES: VoucherType[] = [
  'sales',
  'purchase',
  'sales_order',
  'purchase_order',
  'receipt',
  'payment',
  'journal',
];

export function supportsTallyPush(voucherType: string): boolean {
  return TALLY_PUSH_VOUCHER_TYPES.includes(voucherType as VoucherType);
}

const ACCOUNTING_PUSH_TYPES = new Set(['receipt', 'payment', 'journal']);

export function canPushVoucherToTally(voucher: Voucher): { ok: boolean; reason?: string } {
  if (!supportsTallyPush(voucher.voucherType)) {
    return { ok: false, reason: 'This voucher type cannot be sent to Tally' };
  }
  if (voucher.tallyId) {
    return { ok: false, reason: 'Already synced to Tally' };
  }
  if (ACCOUNTING_PUSH_TYPES.has(voucher.voucherType)) {
    const rows = voucher.entries?.length ?? 0;
    if (rows < 2) {
      return { ok: false, reason: 'Accounting voucher needs at least two ledger lines' };
    }
    return { ok: true };
  }
  if (!voucher.items?.length) {
    return { ok: false, reason: 'Add at least one item before pushing to Tally' };
  }
  if (!voucher.partyName?.trim()) {
    return { ok: false, reason: 'Party name is required for Tally import' };
  }
  return { ok: true };
}

export function buildPushToTallyOptions(
  voucher: Voucher,
  company?: { name?: string; tallyIntegration?: { companyName?: string } }
) {
  const tallyCompanyName =
    company?.tallyIntegration?.companyName || company?.name || undefined;
  const isPurchase = ['purchase', 'purchase_order'].includes(voucher.voucherType);

  return {
    tallyCompanyName,
    tallyVoucherTypeName: voucher.tallyVoucherTypeName,
    placeOfSupply: voucher.placeOfSupply,
    partyName: voucher.partyName,
    ...(isPurchase
      ? { purchaseLedgerName: voucher.purchaseLedgerName }
      : { salesLedgerName: voucher.salesLedgerName }),
  };
}
