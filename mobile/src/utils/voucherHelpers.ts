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

function normalizeType(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '_');
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
