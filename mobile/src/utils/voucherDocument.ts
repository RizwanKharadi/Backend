import type {
  Voucher,
  VoucherEntry,
  VoucherItem,
  TallyVoucherEntryMode,
} from '../types';
import { formatNumber, DOCUMENT_LOCALE } from './formatters';

export const VOUCHER_TYPE_LABELS: Record<string, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  receipt: 'Receipt',
  payment: 'Payment',
  journal: 'Journal',
  contra: 'Contra',
  debit_note: 'Debit Note',
  credit_note: 'Credit Note',
  sales_order: 'Sales Order',
  purchase_order: 'Purchase Order',
  receipt_note: 'Receipt Note',
  delivery_note: 'Delivery Note',
};

/** Accent colors per voucher family (print-safe) */
export const VOUCHER_TYPE_ACCENT: Record<string, string> = {
  sales: '#1565C0',
  purchase: '#6A1B9A',
  receipt: '#2E7D32',
  payment: '#C62828',
  journal: '#455A64',
  contra: '#00838F',
  debit_note: '#E65100',
  credit_note: '#AD1457',
  sales_order: '#3949AB',
  purchase_order: '#5D4037',
  receipt_note: '#558B2F',
  delivery_note: '#F57F17',
};

const BELOW_20 = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function wordsBelow100(n: number): string {
  if (n <= 0) return '';
  if (n < 20) return BELOW_20[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] + (u ? ' ' + BELOW_20[u] : '');
}

function wordsBelow1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let s = '';
  if (h) s += BELOW_20[h] + ' Hundred' + (rest ? ' ' : '');
  if (rest) s += wordsBelow100(rest);
  return s.trim();
}

/** Display/sign-safe voucher total (Tally often stores sales/payment as negative). */
export function resolveVoucherDisplayAmount(voucher: {
  amount?: number;
  totals?: { grandTotal?: number };
  entries?: Array<{ debitAmount?: number; creditAmount?: number }>;
}): number {
  // A balanced voucher's debit total is its true value. Vouchers synced before
  // the agent fix carry a grandTotal taken from Tally's VOUCHER.AMOUNT, which
  // on a multi-ledger accounting voucher is only the first line — a 50 + 140
  // payment stored as 50. Where the entries balance, believe them.
  const entries = voucher.entries || [];
  if (entries.length > 1) {
    const debit = entries.reduce((s, e) => s + Number(e.debitAmount || 0), 0);
    const credit = entries.reduce((s, e) => s + Number(e.creditAmount || 0), 0);
    if (debit > 0 && Math.abs(debit - credit) < 0.01) {
      return Math.abs(debit);
    }
  }

  const fromTotals = voucher.totals?.grandTotal;
  const raw =
    fromTotals != null && Number(fromTotals) !== 0
      ? Number(fromTotals)
      : Number(voucher.amount ?? 0);
  return Math.abs(Number.isFinite(raw) ? raw : 0);
}

/**
 * Stock-item sales/purchase account from Tally ACCOUNTINGALLOCATIONS.LIST
 * (e.g. LEDGERNAME "Sales GST", "Purchase GST") — not LEDGERENTRIES tax lines.
 */
export function isStockAccountAccountingAllocation(
  accountName: string,
  voucher?: Pick<Voucher, 'salesLedgerName' | 'purchaseLedgerName'>
): boolean {
  const name = String(accountName || '').trim();
  if (!name) return false;
  if (/\b(cgst|sgst|igst|utgst|cess|central tax|state tax|integrated tax)\b/i.test(name)) {
    return false;
  }
  const lower = name.toLowerCase();
  const salesLed = String(voucher?.salesLedgerName || '').trim().toLowerCase();
  const purchaseLed = String(voucher?.purchaseLedgerName || '').trim().toLowerCase();
  if (salesLed && lower === salesLed) return true;
  if (purchaseLed && lower === purchaseLed) return true;
  return /^(sales|purchase)(\s|$)/i.test(name);
}

/** Hide only ACCOUNTINGALLOCATIONS stock account rows (Sales GST / Purchase GST). */
export function isInventoryAccountingAllocationEntry(
  entry: VoucherEntry,
  voucher?: Pick<Voucher, 'salesLedgerName' | 'purchaseLedgerName' | 'items'>
): boolean {
  if (!isStockAccountAccountingAllocation(entry.accountName, voucher)) {
    return false;
  }
  if (entry.isAccountingAllocation) return true;
  // Pre-flag sync data: stock account lines on item invoices come from ACCOUNTINGALLOCATIONS.
  return (voucher?.items?.length ?? 0) > 0;
}

export function rupeesToWords(amount: number): string {
  const absAmount = Math.abs(Number(amount) || 0);
  const paise = Math.round((absAmount % 1) * 100);
  const rupees = Math.floor(absAmount);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const convert = (num: number): string => {
    if (num === 0) return '';
    let str = '';
    let n = num;
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) str += wordsBelow100(crore) + ' Crore ';
    if (lakh) str += wordsBelow100(lakh) + ' Lakh ';
    if (thousand) str += wordsBelow100(thousand) + ' Thousand ';
    if (n) str += wordsBelow1000(n);
    return str.trim().replace(/\s+/g, ' ');
  };

  let out = convert(rupees) + ' Rupees';
  if (paise > 0) out += ' and ' + wordsBelow100(paise) + ' Paise';
  return out + ' Only';
}

export function formatDDMMYYYY(dateString: string): string {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Printed documents are pinned to DOCUMENT_LOCALE: an invoice's number format
// is a property of the invoice, not of the language the app is displaying.
export function formatTableAmount(n: number): string {
  return formatNumber(n, {
    locale: DOCUMENT_LOCALE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatInr(amount: number): string {
  return `₹${formatTableAmount(amount)}`;
}

export function formatReference(ref: Voucher['reference']): string {
  if (ref == null || ref === '') return '';
  if (typeof ref === 'object') {
    const num = ref.number;
    if (num) return String(num);
    if (ref.date) return formatDDMMYYYY(String(ref.date));
    return '';
  }
  return String(ref);
}

export function voucherTypeTitle(type: string, tallyName?: string): string {
  if (tallyName?.trim()) return tallyName.trim();
  if (VOUCHER_TYPE_LABELS[type]) return VOUCHER_TYPE_LABELS[type];
  return type
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function voucherDisplayType(v: {
  voucherType: string;
  tallyVoucherTypeName?: string;
  tallyVoucherTypeParent?: string;
}): string {
  return voucherTypeTitle(
    v.voucherType,
    v.tallyVoucherTypeName || v.tallyVoucherTypeParent
  );
}

export function resolveVoucherDisplayMode(v: Voucher): TallyVoucherEntryMode {
  if (v.tallyEntryMode === 'as_voucher') return 'as_voucher';
  const view = String(v.tallyPersistedView || '').toLowerCase();
  if (view.includes('accounting voucher view')) return 'as_voucher';
  if (v.tallyEntryMode) return v.tallyEntryMode;
  if (view.includes('invoice voucher view')) {
    if ((v.items?.length ?? 0) > 0) return 'item_invoice';
    return 'accounting_invoice';
  }
  if ((v.items?.length ?? 0) > 0) return 'item_invoice';
  if ((v.entries?.length ?? 0) > 0) return 'accounting_invoice';
  return 'item_invoice';
}

export function entryModeLabel(mode: TallyVoucherEntryMode, persistedView?: string): string {
  if (mode === 'as_voucher') return 'As Voucher';
  const view = String(persistedView || '').toLowerCase();
  if (view.includes('accounting voucher view')) return 'Accounting Voucher';
  switch (mode) {
    case 'accounting_invoice':
      return 'Accounting Invoice';
    default:
      return 'Item Invoice';
  }
}

export function tallyByToPrefix(entry: VoucherEntry): string {
  if (entry.debitAmount > 0) return 'By';
  if (entry.creditAmount > 0) return 'To';
  return '';
}

export function sortAsVoucherEntries(entries: VoucherEntry[]): VoucherEntry[] {
  return [...entries].sort((a, b) => {
    const aDebit = a.debitAmount > 0 ? 0 : 1;
    const bDebit = b.debitAmount > 0 ? 0 : 1;
    if (aDebit !== bDebit) return aDebit - bDebit;
    return String(a.accountName).localeCompare(String(b.accountName));
  });
}

export function filterLedgerEntriesForDisplay(
  entries: VoucherEntry[],
  partyName?: string,
  includeParty = false,
  voucher?: Pick<Voucher, 'salesLedgerName' | 'purchaseLedgerName' | 'items'>
): VoucherEntry[] {
  let rows = includeParty ? [...entries] : entries;
  const party = (partyName || '').trim().toLowerCase();
  if (!includeParty && party) {
    rows = rows.filter(
      (e) => String(e.accountName || '').trim().toLowerCase() !== party
    );
  }
  rows = rows.filter((e) => !isInventoryAccountingAllocationEntry(e, voucher));
  return rows;
}

export function entryDisplayAmount(entry: VoucherEntry): number {
  if (entry.creditAmount > 0 && entry.debitAmount > 0) {
    return Math.max(entry.creditAmount, entry.debitAmount);
  }
  return entry.creditAmount > 0 ? entry.creditAmount : entry.debitAmount;
}

export function voucherAccentColor(voucherType: string): string {
  return VOUCHER_TYPE_ACCENT[voucherType] || '#0D47A1';
}

export function buildTermsText(voucher: Voucher): string {
  if (!voucher.terms) return '';
  const t = voucher.terms;
  return [t.paymentTerms, t.deliveryTerms, t.otherTerms].filter(Boolean).join('\n');
}

export interface VoucherDocumentContext {
  companyName?: string;
  /**
   * The server stores this as a JSON object
   * ({line1, line2, city, state, pincode, country}); older records may still be
   * a plain string. The invoice renderer accepts either — passing the object
   * straight into a template is what printed "[object Object]".
   */
  companyAddress?: string | Record<string, unknown>;
  companyGst?: string;
  companyPhone?: string;
  companyEmail?: string;
  /** Printed under the seller block and used for the jurisdiction footer. */
  companyState?: string;
  /** Printed as "Company's PAN" above the declaration. */
  companyPan?: string;
}

export function prepareVoucherDocumentData(voucher: Voucher) {
  const displayMode = resolveVoucherDisplayMode(voucher);
  const items = voucher.items || [];
  const isAsVoucher = displayMode === 'as_voucher';
  const isAccountingInvoice = displayMode === 'accounting_invoice';
  const isAccountingVoucherView = String(voucher.tallyPersistedView || '')
    .toLowerCase()
    .includes('accounting voucher view');
  const showItemsSection =
    !isAccountingVoucherView && (!isAccountingInvoice || items.length > 0);
  const ledgerRowsRaw = filterLedgerEntriesForDisplay(
    voucher.entries || [],
    voucher.partyName,
    isAsVoucher,
    voucher
  );
  const ledgerRows = isAsVoucher ? sortAsVoucherEntries(ledgerRowsRaw) : ledgerRowsRaw;
  const ledgerDebitTotal = (voucher.entries || []).reduce(
    (s, e) => s + (e.debitAmount || 0),
    0
  );
  const ledgerCreditTotal = (voucher.entries || []).reduce(
    (s, e) => s + (e.creditAmount || 0),
    0
  );
  const dueStr = voucher.dueDate
    ? formatDDMMYYYY(voucher.dueDate)
    : formatDDMMYYYY(voucher.date);

  return {
    displayMode,
    items,
    isAsVoucher,
    isAccountingInvoice,
    showItemsSection,
    ledgerRows,
    ledgerDebitTotal,
    ledgerCreditTotal,
    dueStr,
    termsText: buildTermsText(voucher),
    accent: voucherAccentColor(voucher.voucherType),
    title: voucherDisplayType(voucher),
    entryMode: entryModeLabel(displayMode, voucher.tallyPersistedView),
  };
}
