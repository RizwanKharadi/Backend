import { Voucher } from '../types';
import { toLocalDateString } from './formatters';

/** First day of current calendar month through today (local dates). */
export function monthStartToToday(): {
  fromDate: string;
  toDate: string;
  startDateIso: string;
  endDateIso: string;
} {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromDate = toLocalDateString(start);
  const toDate = toLocalDateString(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    fromDate,
    toDate,
    startDateIso: start.toISOString(),
    endDateIso: end.toISOString(),
  };
}

const TYPE_ALIASES: Record<string, string[]> = {
  sales: ['sales', 'invoice', 'sales_invoice'],
  purchase: ['purchase', 'purchase_invoice'],
  receipt: ['receipt'],
  payment: ['payment'],
  credit_note: ['credit_note', 'credit note', 'creditnote'],
  debit_note: ['debit_note', 'debit note', 'debitnote'],
  journal: ['journal'],
  contra: ['contra'],
};

/**
 * Tally voucher types that record a commitment or a stock movement, NOT an
 * accounting entry. They must never be absorbed into an accounting bucket by the
 * loose substring match below — `"sales_order".includes("sales")` is true, which
 * previously counted Sales Orders as Sales (and Receipt Notes as Receipts,
 * Purchase Orders as Purchases, Stock Journals as Journals).
 */
const NON_ACCOUNTING_TYPES = new Set([
  'sales_order',
  'purchase_order',
  'quotation',
  'delivery_note',
  'receipt_note',
  'rejection_in',
  'rejection_out',
  'material_in',
  'material_out',
  'physical_stock',
  'stock_journal',
]);

function normalizeType(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '_');
}

/**
 * True for vouchers that record a commitment or a stock movement rather than
 * money changing hands. They have no debit/credit side, so they must never be
 * shown with a +/- sign or an inflow/outflow colour.
 */
export function isNonAccountingVoucherType(value?: string): boolean {
  if (!value) return false;
  return NON_ACCOUNTING_TYPES.has(normalizeType(value));
}

export function matchesVoucherType(voucher: Voucher, typeId: string): boolean {
  const t = normalizeType(voucher.voucherType || '');
  const id = normalizeType(typeId);
  if (t === id) return true;
  // Tally parent type is the reliable signal for renamed/custom voucher types.
  const parent = normalizeType(
    (voucher as { tallyVoucherTypeParent?: string }).tallyVoucherTypeParent || ''
  );
  if (parent && parent === id) return true;

  // Past this point only fuzzy matching remains. An order/note voucher matches
  // its own type exactly (handled above) or nothing at all.
  if (NON_ACCOUNTING_TYPES.has(t) || (parent !== '' && NON_ACCOUNTING_TYPES.has(parent))) {
    return false;
  }

  const aliases = TYPE_ALIASES[id] || [id];
  return aliases.some(
    (a) =>
      t === normalizeType(a) ||
      t.includes(normalizeType(a)) ||
      (parent !== '' && parent === normalizeType(a))
  );
}

export function isSalesVoucher(voucher: Voucher): boolean {
  return matchesVoucherType(voucher, 'sales');
}

export function getVoucherTotalAmount(voucher: Voucher): number {
  const fromTotals = (voucher as any)?.totals?.grandTotal;
  const fromAmount = (voucher as any)?.amount;
  const value =
    fromTotals != null
      ? Number(fromTotals)
      : fromAmount != null
        ? Number(fromAmount)
        : 0;
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

export function sumVoucherAmounts(vouchers: Voucher[]): number {
  return vouchers.reduce((s, v) => s + getVoucherTotalAmount(v), 0);
}

/** Sum sales voucher amounts between fromDate and toDate (YYYY-MM-DD, inclusive). */
export function monthSalesRevenue(
  vouchers: Voucher[],
  fromDate: string,
  toDate: string
): number {
  return sumVoucherAmounts(
    filterVouchersInRange(vouchers, fromDate, toDate).filter(isSalesVoucher)
  );
}

export interface TopPartySummary {
  name: string;
  amount: number;
}

/** Rank #1 customer by sales amount from voucher list (fallback when Top-10 API empty). */
export function topCustomerFromVouchers(vouchers: Voucher[]): TopPartySummary | null {
  const totals = new Map<string, number>();
  for (const v of vouchers) {
    if (!isSalesVoucher(v)) continue;
    const name = (v.partyName || '').trim();
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + getVoucherTotalAmount(v));
  }
  let best: TopPartySummary | null = null;
  totals.forEach((amount, name) => {
    if (!best || amount > best.amount) {
      best = { name, amount };
    }
  });
  return best;
}

export function filterVouchersInRange(
  vouchers: Voucher[],
  fromDate: string,
  toDate: string
): Voucher[] {
  return vouchers.filter((v) => {
    const d = (v.date || v.createdAt || '').slice(0, 10);
    return d >= fromDate && d <= toDate;
  });
}
