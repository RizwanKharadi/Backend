import type { SalesVoucherItemLine, SalesExtraLedgerLine } from '../types';

/** Line amount before tax (qty × rate minus discount). Tax is added via ledger lines only. */
export function lineTaxableAmount(line: SalesVoucherItemLine): number {
  const qty = Number(line.quantity) || 0;
  const rate = Number(line.rate) || 0;
  const base = qty * rate;
  const discountPct = Number(line.discountPercent) || 0;
  return Number((base - (base * discountPct) / 100).toFixed(2));
}

/** @deprecated Tax is not calculated on items — use extra ledger lines */
export function lineTaxAmount(_line: SalesVoucherItemLine): number {
  return 0;
}

export function lineTotalWithTax(line: SalesVoucherItemLine): number {
  return lineTaxableAmount(line);
}

export function summarizeSalesInvoice(
  items: SalesVoucherItemLine[],
  extraLedgers: SalesExtraLedgerLine[] = []
) {
  const netTotal = items.reduce((s, l) => s + lineTaxableAmount(l), 0);
  const totalTax = extraLedgers.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const grossTotal = netTotal + totalTax;

  return {
    netTotal: Number(netTotal.toFixed(2)),
    totalTax: Number(totalTax.toFixed(2)),
    grossTotal: Number(grossTotal.toFixed(2)),
  };
}
