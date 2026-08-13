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

/**
 * A voucher's value lives in the totals JSON. There is no flat `amount` column on
 * this table — reading one is what broke every voucher-backed report in
 * production, since selecting a column MySQL does not have fails the whole query.
 */
export const voucherAmount = (v) => Math.abs(num(v?.totals?.grandTotal));

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

/**
 * The parties table holds the whole chart of ledgers, not just trading parties:
 * the agent uploads every Tally ledger through the party path and tags the
 * sundry ones `recordType: 'party'`, leaving bank, cash, duty and expense
 * ledgers as `'ledger'`. Counting customers without this filter counts all of
 * them — the party list endpoint has always applied it, so a count that skipped
 * it disagreed with the list on the same screen.
 *
 * null is included because rows created before recordType existed have none.
 */
export const PARTY_ONLY = { recordType: { $in: ['party', null] } };

/** Days between order and delivery, if the customer has recorded one. */
export const leadTimeDays = (item) => {
  const value = num(item?.inventory?.leadTimeDays);
  return value > 0 ? value : 7;
};

/**
 * Columns read for sales reporting. Exported so a test can assert every one of
 * them actually exists on the model: naming a column that does not exist throws
 * at query time, not at startup, so it surfaces as a 500 on a live endpoint.
 */
export const SALES_VOUCHER_FIELDS = ['date', 'totals', 'party', 'partyName'];
export const SALES_VOUCHER_ITEM_FIELD = 'items';

export async function loadSalesVouchers(companyId, sinceDays, { withItems = false } = {}) {
  const since = new Date(Date.now() - sinceDays * DAY_MS);
  const fields = [...SALES_VOUCHER_FIELDS];
  if (withItems) fields.push(SALES_VOUCHER_ITEM_FIELD);

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
