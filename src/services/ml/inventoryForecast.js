/**
 * Inventory demand forecasting.
 *
 * Demand forecasting for an SME catalogue is mostly a data problem, not a
 * modelling one: a typical item has a few dozen sales a year, often clustered.
 * So this stays a rate-and-seasonality model whose every term can be read off the
 * response, and spends its effort on being honest about uncertainty instead.
 *
 * Three things the service this replaces got wrong, all of which mattered more
 * than the choice of model:
 *
 *  - It divided total quantity by the number of *days that had a sale*, so an
 *    item sold once a month came out at a full month's demand per day. Slow
 *    movers were overstated by an order of magnitude.
 *  - Seasonality was a hardcoded table of festive-season multipliers applied to
 *    every item of every business. Here it is measured from the company's own
 *    sales, and skipped entirely when there is not enough history to measure.
 *  - Confidence was the literal constant 0.75 on every response.
 */

import Item from '../../models/Item.js';
import {
  DAY_MS,
  num,
  itemStock,
  reorderLevel,
  leadTimeDays,
  loadSalesVouchers,
} from './dataAccess.js';
import { normalisePartyKey } from '../billHistoryService.js';

// Forecasting every item of a large catalogue would return megabytes the caller
// cannot use. With no explicit selection we cover the busiest items.
const MAX_ITEMS_WITHOUT_SELECTION = 50;

// Below this much history a rate is guesswork; the window is floored here so a
// single sale last week cannot imply a huge daily demand.
const MIN_OBSERVATION_DAYS = 30;

// Seasonality needs enough of a year to be a measurement rather than a rumour.
const MIN_DAYS_FOR_SEASONALITY = 180;
const MIN_LINES_FOR_SEASONALITY = 60;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const itemKey = (nameOrId) => normalisePartyKey(nameOrId);

/** Sale lines per item over the window, plus the company-wide monthly totals. */
function buildSalesIndex(vouchers) {
  const perItem = new Map();
  const companyByMonth = new Map();
  let totalLines = 0;
  let earliest = null;

  for (const v of vouchers) {
    if (!v.date) continue;
    const when = new Date(v.date);
    if (!earliest || when < earliest) earliest = when;

    for (const line of Array.isArray(v.items) ? v.items : []) {
      const key = itemKey(line?.itemName) || String(line?.item || '');
      if (!key) continue;
      const qty = num(line?.quantity);
      if (qty <= 0) continue;

      const entry = perItem.get(key) || { lines: [], total: 0, firstSale: when };
      entry.lines.push({ when, qty });
      entry.total += qty;
      if (when < entry.firstSale) entry.firstSale = when;
      perItem.set(key, entry);

      const month = when.getMonth();
      companyByMonth.set(month, (companyByMonth.get(month) || 0) + qty);
      totalLines += 1;
    }
  }

  return { perItem, companyByMonth, totalLines, earliest };
}

/**
 * Monthly multipliers measured from the company's own sales, normalised to mean 1.
 *
 * Deliberately company-wide rather than per item: twelve months of history gives
 * one observation per month per item, which is far too thin to separate a genuine
 * seasonal pattern from noise. Pooling across the catalogue at least measures the
 * shape of *this* business's year.
 *
 * Returns null when there is not enough history, and the caller then forecasts a
 * flat rate rather than inventing a curve.
 */
function seasonalFactors({ companyByMonth, totalLines, earliest }) {
  if (!earliest || totalLines < MIN_LINES_FOR_SEASONALITY) return null;

  const historyDays = (Date.now() - earliest.getTime()) / DAY_MS;
  if (historyDays < MIN_DAYS_FOR_SEASONALITY) return null;

  const observed = [...companyByMonth.values()];
  if (observed.length < 6) return null;

  const mean = observed.reduce((a, b) => a + b, 0) / observed.length;
  if (mean <= 0) return null;

  const factors = new Map();
  for (let month = 0; month < 12; month += 1) {
    const value = companyByMonth.get(month);
    // Months never observed sit at 1.0 rather than 0 — no evidence is not
    // evidence of no demand.
    factors.set(month, value == null ? 1 : clamp(value / mean, 0.5, 2));
  }
  return factors;
}

/**
 * How much to trust this item's forecast: enough sales to establish a rate, and
 * a rate that is not wildly erratic week to week.
 */
function confidenceFor(lines, observationDays) {
  if (!lines.length) return 0.05;

  const volume = clamp(lines.length / 30, 0, 1);

  // Weekly buckets, so a steady seller scores above a lumpy one.
  const weeks = Math.max(1, Math.round(observationDays / 7));
  const buckets = new Array(weeks).fill(0);
  const start = Date.now() - observationDays * DAY_MS;
  for (const { when, qty } of lines) {
    const idx = clamp(Math.floor((when.getTime() - start) / (7 * DAY_MS)), 0, weeks - 1);
    buckets[idx] += qty;
  }

  const mean = buckets.reduce((a, b) => a + b, 0) / weeks;
  let stability = 0;
  if (mean > 0) {
    const variance = buckets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / weeks;
    const cv = Math.sqrt(variance) / mean;
    stability = 1 / (1 + cv);
  }

  // Capped below 1: this is a rate projection, never a certainty.
  return Number(clamp(volume * 0.6 + stability * 0.4, 0.05, 0.9).toFixed(2));
}

function forecastItem(item, stats, factors, { daysAhead, includeRecommendations }) {
  const name = item.displayName || item.name;
  const stock = itemStock(item);
  const level = reorderLevel(item);
  const leadTime = leadTimeDays(item);
  const lines = stats?.lines || [];

  // Rate is measured over the period the item has actually been selling for, not
  // a flat year — an item introduced last month must not look like a slow mover.
  const observedDays = stats?.firstSale
    ? clamp((Date.now() - stats.firstSale.getTime()) / DAY_MS, MIN_OBSERVATION_DAYS, 365)
    : MIN_OBSERVATION_DAYS;
  const dailyDemand = stats ? stats.total / observedDays : 0;

  const predicted = [];
  let horizonDemand = 0;
  for (let day = 1; day <= daysAhead; day += 1) {
    const date = new Date(Date.now() + day * DAY_MS);
    const factor = factors ? factors.get(date.getMonth()) ?? 1 : 1;
    const value = dailyDemand * factor;
    horizonDemand += value;
    predicted.push({
      date: date.toISOString(),
      predicted_demand: Math.round(value * 100) / 100,
    });
  }

  const confidence = confidenceFor(lines, observedDays);

  const result = {
    item_id: String(item.id),
    item_name: name,
    current_stock: stock,
    predicted_demand: predicted,
    confidence_score: confidence,
    meta: {
      daily_demand: Number(dailyDemand.toFixed(3)),
      observation_days: Math.round(observedDays),
      sales_lines: lines.length,
      seasonality_applied: Boolean(factors),
      lead_time_days: leadTime,
      horizon_demand: Math.round(horizonDemand),
    },
  };

  if (!includeRecommendations) return result;

  if (dailyDemand <= 0) {
    result.reorder_recommendation = {
      should_reorder: false,
      recommended_quantity: 0,
      reorder_date: null,
      reason: 'No sales recorded in the last year, so there is no demand to reorder against.',
    };
    return result;
  }

  // Safety stock is the customer's own reorder level when they have set one —
  // they know their supply risk better than a formula does.
  const safetyStock = level > 0 ? level : Math.ceil(dailyDemand * leadTime * 0.5);
  const reorderPoint = Math.ceil(dailyDemand * leadTime + safetyStock);
  const shouldReorder = stock <= reorderPoint;

  // Order up to cover the lead time plus a month, less what is on hand.
  const targetStock = Math.ceil(dailyDemand * (leadTime + 30) + safetyStock);
  const quantity = Math.max(0, targetStock - stock);

  const daysUntilReorder = stock > reorderPoint ? (stock - reorderPoint) / dailyDemand : 0;
  const reorderDate = new Date(Date.now() + daysUntilReorder * DAY_MS);
  const daysCover = Math.round(stock / dailyDemand);

  result.reorder_recommendation = {
    should_reorder: shouldReorder,
    recommended_quantity: shouldReorder ? quantity : 0,
    reorder_date: reorderDate.toISOString(),
    reason: shouldReorder
      ? `${stock} in stock is at or below the reorder point of ${reorderPoint} (about ${daysCover} days of cover at ${dailyDemand.toFixed(2)}/day).`
      : `${stock} in stock covers about ${daysCover} days; reorder around ${reorderDate.toDateString()}.`,
  };

  return result;
}

/**
 * @param {string[]} [itemIds]  ids or names; empty means the busiest items
 * @param {number}   [daysAhead]
 * @param {boolean}  [includeSeasonality]
 * @param {boolean}  [includeRecommendations]
 */
export async function forecastInventoryDemand(
  companyId,
  {
    itemIds = [],
    daysAhead = 90,
    includeSeasonality = true,
    includeRecommendations = true,
  } = {}
) {
  const horizon = clamp(Math.round(daysAhead) || 90, 1, 365);

  const [items, vouchers] = await Promise.all([
    Item.find({ company: companyId, isActive: true })
      .select('name displayName inventory')
      .lean(),
    loadSalesVouchers(companyId, 365, { withItems: true }),
  ]);

  const index = buildSalesIndex(vouchers);
  const factors = includeSeasonality ? seasonalFactors(index) : null;

  let selected;
  if (itemIds.length) {
    const wanted = new Set(itemIds.map((id) => String(id).trim()));
    const wantedKeys = new Set([...wanted].map(itemKey));
    selected = items.filter(
      (item) => wanted.has(String(item.id)) || wantedKeys.has(itemKey(item.name))
    );
  } else {
    // Busiest first, so an unfiltered request returns the items worth acting on.
    selected = [...items]
      .sort(
        (a, b) =>
          (index.perItem.get(itemKey(b.name))?.total || 0) -
          (index.perItem.get(itemKey(a.name))?.total || 0)
      )
      .slice(0, MAX_ITEMS_WITHOUT_SELECTION);
  }

  return selected.map((item) =>
    forecastItem(item, index.perItem.get(itemKey(item.name)), factors, {
      daysAhead: horizon,
      includeRecommendations,
    })
  );
}

export default { forecastInventoryDemand };
