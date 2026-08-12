/**
 * Shared reads and field conventions for the insights services.
 *
 * These exist so "current stock" and "what a sale is worth" have exactly one
 * definition. Two modules computing stock slightly differently is how a dashboard
 * tile and a detail screen end up disagreeing, which for a product whose whole
 * promise is reconciling with Tally is worse than being wrong loudly.
 */

import Voucher from '../../models/Voucher.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

// Tally-synced vouchers use lowercase types; older app-created rows used 'Sales'.
export const SALES_TYPES = ['sales', 'Sales'];

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Vouchers store value in totals.grandTotal, with an older flat amount as fallback. */
export const voucherAmount = (v) => Math.abs(num(v?.totals?.grandTotal ?? v?.amount));

export const monthKey = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/** Stock is held per godown; summed the same way as inventoryController does it. */
export function itemStock(item) {
  const current = Array.isArray(item?.inventory?.currentStock) ? item.inventory.currentStock : [];
  return current.reduce((sum, c) => sum + num(c?.availableQuantity ?? c?.quantity ?? c?.qty), 0);
}

export const reorderLevel = (item) => num(item?.inventory?.stockLevels?.reorderLevel);

/** Days between order and delivery, if the customer has recorded one. */
export const leadTimeDays = (item) => {
  const value = num(item?.inventory?.leadTimeDays);
  return value > 0 ? value : 7;
};

export async function loadSalesVouchers(companyId, sinceDays, { withItems = false } = {}) {
  const since = new Date(Date.now() - sinceDays * DAY_MS);
  const fields = ['date', 'totals', 'amount', 'party', 'partyName'];
  if (withItems) fields.push('items');

  return Voucher.find({
    company: companyId,
    voucherType: { $in: SALES_TYPES },
    date: { $gte: since },
  })
    .select(fields.join(' '))
    .lean();
}

export default {
  DAY_MS,
  SALES_TYPES,
  num,
  voucherAmount,
  monthKey,
  itemStock,
  reorderLevel,
  leadTimeDays,
  loadSalesVouchers,
};
