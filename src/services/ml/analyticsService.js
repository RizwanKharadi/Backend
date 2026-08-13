/**
 * The five analytics endpoints, computed from MySQL.
 *
 * Every figure here comes from rows that were synced from Tally, so the totals
 * reconcile with what the customer sees in Tally itself. Where something cannot
 * be computed — no sales yet, no settled bills — the response says so through
 * empty lists and nulls rather than filling the gap with a plausible number.
 *
 * All queries are scoped by company. There is no cross-tenant aggregate anywhere
 * in this file and there must never be one.
 */

import Party from '../../models/Party.js';
import Item from '../../models/Item.js';
import BillHistory from '../../models/BillHistory.js';
import OutstandingReceivable from '../../models/OutstandingReceivable.js';
import { getPartyPaymentBehaviour, normalisePartyKey } from '../billHistoryService.js';
import { scoreParty } from './riskScoring.js';
import {
  DAY_MS,
  num,
  voucherAmount,
  monthKey,
  itemStock,
  reorderLevel,
  loadSalesVouchers,
  PARTY_ONLY,
} from './dataAccess.js';

const pct = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0);

/** Current exposure per party, straight off Tally's outstanding report. */
async function loadOutstanding(companyId) {
  const report = await OutstandingReceivable.findOne({
    company: companyId,
    reportName: 'Bills Receivable',
  })
    .select('ledgers totalOutstanding asOfDate')
    .lean();

  const byParty = new Map();
  let totalOverdue = 0;
  const overdueBills = [];

  for (const ledger of report?.ledgers || []) {
    const partyName = String(ledger?.partyName || '').trim();
    if (!partyName) continue;

    const bills = Array.isArray(ledger?.bills) ? ledger.bills : [];
    let overdueAmount = 0;

    for (const bill of bills) {
      const balance = Math.abs(num(bill?.closingBalance));
      const overdueDays = num(bill?.billOverdue);
      if (overdueDays > 0 && balance > 0) {
        overdueAmount += balance;
        totalOverdue += balance;
        overdueBills.push({
          partyName,
          billRef: String(bill?.billRef || ''),
          amount: balance,
          daysOverdue: Math.round(overdueDays),
        });
      }
    }

    byParty.set(normalisePartyKey(partyName), {
      partyName,
      outstanding: num(ledger?.totalOutstanding),
      billCount: num(ledger?.billCount) || bills.length,
      overdueAmount,
      oldestOverdueDays: num(ledger?.oldestOverdueDays),
    });
  }

  return {
    byParty,
    overdueBills,
    totalOverdue,
    totalOutstanding: num(report?.totalOutstanding),
    asOfDate: report?.asOfDate || null,
  };
}

/**
 * Quantity sold per item over the window, split into the most recent 90 days and
 * the 90 before them so a direction can be read off the two.
 * Keyed by normalised item name, which is what voucher lines carry.
 */
function soldQuantities(vouchers) {
  const now = Date.now();
  const recentCut = now - 90 * DAY_MS;
  const priorCut = now - 180 * DAY_MS;
  const sold = new Map();

  for (const v of vouchers) {
    const when = v.date ? new Date(v.date).getTime() : 0;
    for (const line of Array.isArray(v.items) ? v.items : []) {
      const key = normalisePartyKey(line?.itemName) || String(line?.item || '');
      if (!key) continue;
      const qty = num(line?.quantity);
      if (qty <= 0) continue;

      const entry = sold.get(key) || { total: 0, recent: 0, prior: 0 };
      entry.total += qty;
      if (when >= recentCut) entry.recent += qty;
      else if (when >= priorCut) entry.prior += qty;
      sold.set(key, entry);
    }
  }

  return sold;
}

/**
 * Low stock and overstock counts, shared by the dashboard tile and the detailed
 * inventory endpoint so the two can never disagree.
 *
 * Overstock is measured against a demand rate: an item that never sells is dead
 * stock, which is a different problem, and counting it here would make the number
 * meaningless for anyone with a long tail of slow movers.
 */
function stockCounts(items, sold) {
  let lowStock = 0;
  let overstock = 0;

  for (const item of items) {
    const stock = itemStock(item);
    const level = reorderLevel(item);
    if (level > 0 && stock <= level) lowStock += 1;

    const dailyDemand = (sold.get(normalisePartyKey(item.name))?.total || 0) / 365;
    if (dailyDemand > 0 && stock / dailyDemand > 90) overstock += 1;
  }

  return { lowStock, overstock };
}

/* ------------------------------------------------------------------ *
 * 1. Business metrics
 * ------------------------------------------------------------------ */

export async function getBusinessMetrics(companyId, daysBack = 30) {
  const [vouchers, behaviour, outstanding, parties, items] = await Promise.all([
    loadSalesVouchers(companyId, 365, { withItems: true }),
    getPartyPaymentBehaviour({ company: companyId }),
    loadOutstanding(companyId),
    Party.find({ company: companyId, isActive: true, ...PARTY_ONLY })
      .select('name createdAt')
      .lean(),
    Item.find({ company: companyId, isActive: true }).select('name inventory').lean(),
  ]);

  // Revenue by calendar month.
  const byMonth = new Map();
  for (const v of vouchers) {
    if (!v.date) continue;
    const key = monthKey(v.date);
    byMonth.set(key, (byMonth.get(key) || 0) + voucherAmount(v));
  }

  const now = new Date();
  const currentKey = monthKey(now);
  const completed = [...byMonth.entries()]
    .filter(([key]) => key !== currentKey)
    .sort(([a], [b]) => a.localeCompare(b));

  const currentMonth = byMonth.get(currentKey) || 0;
  const last = completed.at(-1)?.[1] ?? 0;
  const prev = completed.at(-2)?.[1] ?? 0;

  // Month on month, from the last two *complete* months — the current one is
  // partial and would always read as a collapse.
  let growthRate = prev > 0 ? (last - prev) / prev : 0;
  growthRate = Math.max(-0.5, Math.min(0.5, growthRate));

  const recent = completed.slice(-3).map(([, value]) => value);
  const baseline = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const nextMonth = completed.length >= 2 ? baseline * (1 + growthRate) : baseline;

  // Payment behaviour, aggregated across parties.
  let settled = 0;
  let late = 0;
  let delaySum = 0;
  for (const stats of behaviour.values()) {
    settled += stats.settledCount;
    late += stats.lateCount;
    delaySum += Math.max(0, stats.avgDaysLate) * stats.settledCount;
  }

  // A party counts as high risk on the evidence available now; parties with no
  // history at all are not assumed risky.
  let highRisk = 0;
  for (const [key, exposure] of outstanding.byParty) {
    const { level } = scoreParty({
      behaviour: behaviour.get(key),
      outstanding: exposure.outstanding,
      overdueAmount: exposure.overdueAmount,
      oldestOverdueDays: exposure.oldestOverdueDays,
    });
    if (level === 'High') highRisk += 1;
  }

  const windowStart = new Date(Date.now() - daysBack * DAY_MS);
  const newCustomers = parties.filter(
    (p) => p.createdAt && new Date(p.createdAt) >= windowStart
  ).length;

  const { lowStock, overstock } = stockCounts(items, soldQuantities(vouchers));

  return {
    revenue_forecast: {
      current_month: Math.round(currentMonth),
      next_month: Math.round(nextMonth),
      growth_rate: Number(growthRate.toFixed(4)),
    },
    payment_insights: {
      on_time_percentage: pct(settled - late, settled),
      average_delay_days: settled > 0 ? Number((delaySum / settled).toFixed(1)) : 0,
      total_overdue: Math.round(outstanding.totalOverdue),
    },
    customer_analytics: {
      total_customers: parties.length,
      high_risk_customers: highRisk,
      new_customers: newCustomers,
    },
    inventory_insights: {
      total_items: items.length,
      low_stock_items: lowStock,
      overstock_items: overstock,
    },
    meta: {
      days_back: daysBack,
      settled_bills: settled,
      as_of: outstanding.asOfDate,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. Customer insights
 * ------------------------------------------------------------------ */

/** Mobile may pass a party id or the name shown on screen. */
async function findParty(companyId, customerId) {
  const id = String(customerId || '').trim();
  if (!id) return null;

  const byId = await Party.findOne({ company: companyId, id }).lean();
  if (byId) return byId;

  const all = await Party.find({ company: companyId })
    .select('name displayName creditLimit balances type createdAt')
    .lean();
  const key = normalisePartyKey(id);
  return (
    all.find((p) => normalisePartyKey(p.name) === key) ||
    all.find((p) => normalisePartyKey(p.displayName) === key) ||
    null
  );
}

export async function getCustomerInsights(companyId, customerId) {
  const party = await findParty(companyId, customerId);
  if (!party) return null;

  const key = normalisePartyKey(party.name || party.displayName);

  const [behaviourMap, outstanding, vouchers, settledBills] = await Promise.all([
    getPartyPaymentBehaviour({ company: companyId }),
    loadOutstanding(companyId),
    loadSalesVouchers(companyId, 365),
    BillHistory.find({ company: companyId, status: 'settled' })
      .select('partyKey settledAt daysLate')
      .lean(),
  ]);

  const behaviour = behaviourMap.get(key) || null;
  const exposure = outstanding.byParty.get(key) || { outstanding: 0, overdueAmount: 0, oldestOverdueDays: 0 };

  const creditLimit = num(party?.creditLimit?.amount);
  const outstandingAmount =
    exposure.outstanding || num(party?.balances?.current?.amount);

  const risk = scoreParty({
    behaviour,
    creditLimit,
    outstanding: outstandingAmount,
    overdueAmount: exposure.overdueAmount,
    oldestOverdueDays: exposure.oldestOverdueDays,
  });

  // Six months of on-time performance, by the month each bill was settled.
  // Months with no settled bill report null rather than 0% — nothing was paid
  // late, there was simply nothing to pay.
  const trends = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    trends.push({ month: monthKey(d), settled: 0, onTime: 0 });
  }
  const trendIndex = new Map(trends.map((t) => [t.month, t]));

  for (const bill of settledBills) {
    if (bill.partyKey !== key || bill.daysLate == null || !bill.settledAt) continue;
    const bucket = trendIndex.get(monthKey(bill.settledAt));
    if (!bucket) continue;
    bucket.settled += 1;
    if (bill.daysLate <= 0) bucket.onTime += 1;
  }

  // Party monthly turnover, used for the credit-limit suggestion.
  const partySales = vouchers.filter((v) => normalisePartyKey(v.partyName) === key);
  const monthlySales = new Map();
  for (const v of partySales) {
    if (!v.date) continue;
    const m = monthKey(v.date);
    monthlySales.set(m, (monthlySales.get(m) || 0) + voucherAmount(v));
  }

  const months = [...monthlySales.values()];
  const avgMonthly = months.length ? months.reduce((a, b) => a + b, 0) / months.length : 0;

  // Only suggest a change when there is both turnover history and payment
  // history to justify it; otherwise leave the existing limit alone.
  let recommendedLimit = creditLimit;
  if (months.length >= 3 && behaviour?.settledCount >= 3) {
    const multiplier = risk.level === 'High' ? 1 : risk.level === 'Medium' ? 1.5 : 2;
    recommendedLimit = Math.round((avgMonthly * multiplier) / 1000) * 1000;
  }

  return {
    customer_id: String(party.id ?? customerId),
    customer_name: party.displayName || party.name,
    payment_behavior: {
      average_delay_days: behaviour ? Math.max(0, behaviour.avgDaysLate) : 0,
      on_time_percentage: behaviour
        ? pct(behaviour.settledCount - behaviour.lateCount, behaviour.settledCount)
        : 0,
      total_transactions: behaviour?.settledCount || 0,
    },
    risk_profile: {
      risk_score: risk.score,
      risk_level: risk.level,
      credit_limit: creditLimit,
      credit_utilization: creditLimit > 0 ? Number((outstandingAmount / creditLimit).toFixed(4)) : 0,
    },
    predictions: {
      next_payment_delay_probability: risk.score,
      recommended_credit_limit: recommendedLimit,
    },
    trends: trends.map(({ month, settled, onTime }) => ({
      month,
      payment_performance: settled > 0 ? pct(onTime, settled) : null,
      bills_settled: settled,
    })),
    confidence: risk.confidence,
    factors: risk.factors,
    meta: {
      settled_bills: behaviour?.settledCount || 0,
      outstanding: Math.round(outstandingAmount),
      average_monthly_purchase: Math.round(avgMonthly),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 3. Inventory analytics
 * ------------------------------------------------------------------ */

export async function getInventoryAnalytics(companyId) {
  const [items, vouchers] = await Promise.all([
    Item.find({ company: companyId, isActive: true }).select('name displayName inventory').lean(),
    loadSalesVouchers(companyId, 365, { withItems: true }),
  ]);

  const sold = soldQuantities(vouchers);

  const lowStockItems = [];
  const overstockItems = [];
  const demandTrends = [];
  const reorderRecommendations = [];

  for (const item of items) {
    const name = item.displayName || item.name;
    const key = normalisePartyKey(item.name);
    const stock = itemStock(item);
    const level = reorderLevel(item);
    const stats = sold.get(key) || { total: 0, recent: 0, prior: 0 };
    const dailyDemand = stats.total / 365;

    if (level > 0 && stock <= level) {
      lowStockItems.push({
        item_id: String(item.id),
        item_name: name,
        current_stock: stock,
        reorder_level: level,
      });
    }

    // Overstock only means something against a demand rate. An item that never
    // sells is a separate problem (dead stock), not overstock.
    if (dailyDemand > 0) {
      const daysCover = stock / dailyDemand;
      if (daysCover > 90) {
        overstockItems.push({
          item_id: String(item.id),
          item_name: name,
          current_stock: stock,
          optimal_stock: Math.ceil(dailyDemand * 60),
        });
      }
    }

    if (stats.recent > 0 || stats.prior > 0) {
      const change = stats.prior > 0 ? (stats.recent - stats.prior) / stats.prior : 1;
      demandTrends.push({
        item_id: String(item.id),
        item_name: name,
        trend: change > 0.15 ? 'increasing' : change < -0.15 ? 'decreasing' : 'stable',
        change_percentage: Number((change * 100).toFixed(1)),
      });
    }

    if (dailyDemand > 0 && (stock <= level || stock / dailyDemand < 30)) {
      const daysCover = stock / dailyDemand;

      // Days of cover drives urgency, but sitting at or below the reorder level
      // is the customer's own signal that they want stock — a slow mover can have
      // months of cover on paper and still be below the level they set.
      let urgency = 'low';
      if (stock <= 0 || daysCover < 7) urgency = 'high';
      else if (daysCover < 21 || (level > 0 && stock <= level)) urgency = 'medium';

      reorderRecommendations.push({
        item_id: String(item.id),
        item_name: name,
        recommended_quantity: Math.max(1, Math.ceil(dailyDemand * 30 + level - stock)),
        urgency,
      });
    }
  }

  const urgencyRank = { high: 0, medium: 1, low: 2 };

  return {
    total_items: items.length,
    low_stock_items: lowStockItems.sort((a, b) => a.current_stock - b.current_stock),
    overstock_items: overstockItems.sort((a, b) => b.current_stock - a.current_stock),
    demand_trends: demandTrends
      .sort((a, b) => Math.abs(b.change_percentage) - Math.abs(a.change_percentage))
      .slice(0, 20),
    reorder_recommendations: reorderRecommendations.sort(
      (a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency]
    ),
  };
}

/* ------------------------------------------------------------------ *
 * 4. Payment trends
 * ------------------------------------------------------------------ */

export async function getPaymentTrends(companyId) {
  const [recent, older] = await Promise.all([
    getPartyPaymentBehaviour({ company: companyId, sinceDays: 90 }),
    getPartyPaymentBehaviour({ company: companyId, sinceDays: 180 }),
  ]);

  // Monthly buckets need per-bill rows, which the behaviour summary folds away.
  const since = new Date(Date.now() - 365 * DAY_MS);
  const bills = await BillHistory.find({
    company: companyId,
    status: 'settled',
    settledAt: { $gte: since },
  })
    .select('settledAt daysLate partyName partyKey')
    .lean();

  const buckets = new Map();
  const seasonal = new Map();

  for (const bill of bills) {
    if (bill.daysLate == null || !bill.settledAt) continue;
    const settledAt = new Date(bill.settledAt);
    const key = monthKey(settledAt);

    const bucket = buckets.get(key) || {
      month: key,
      total_payments: 0,
      on_time_payments: 0,
      delayed_payments: 0,
      _delaySum: 0,
    };
    bucket.total_payments += 1;
    if (bill.daysLate > 0) {
      bucket.delayed_payments += 1;
      bucket._delaySum += bill.daysLate;
    } else {
      bucket.on_time_payments += 1;
    }
    buckets.set(key, bucket);

    const m = settledAt.getMonth() + 1;
    const s = seasonal.get(m) || { total: 0, onTime: 0 };
    s.total += 1;
    if (bill.daysLate <= 0) s.onTime += 1;
    seasonal.set(m, s);
  }

  const monthly = [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ _delaySum, ...b }) => ({
      ...b,
      average_delay_days: b.total_payments ? Number((_delaySum / b.total_payments).toFixed(1)) : 0,
    }));

  // Direction per party: the last 90 days against the 90 before them. `older`
  // covers 180 days, so the earlier window is what it holds beyond `recent`.
  const customerTrends = [];
  for (const [key, recentStats] of recent) {
    const wideStats = older.get(key);
    if (!wideStats || wideStats.settledCount <= recentStats.settledCount) continue;

    const earlierCount = wideStats.settledCount - recentStats.settledCount;
    const earlierDelaySum =
      wideStats.avgDaysLate * wideStats.settledCount - recentStats.avgDaysLate * recentStats.settledCount;
    const earlierAvg = earlierCount > 0 ? earlierDelaySum / earlierCount : 0;

    // Lower delay is better, so an improvement is a fall.
    const change = earlierAvg !== 0 ? (recentStats.avgDaysLate - earlierAvg) / Math.abs(earlierAvg) : 0;

    customerTrends.push({
      customer_id: key,
      customer_name: recentStats.partyName,
      trend: change < -0.15 ? 'improving' : change > 0.15 ? 'declining' : 'stable',
      change_percentage: Number((change * 100).toFixed(1)),
    });
  }

  const seasonalPatterns = [...seasonal.entries()]
    .sort(([a], [b]) => a - b)
    .map(([month, s]) => ({
      month,
      payment_performance_index: Number((s.onTime / s.total).toFixed(3)),
    }));

  return {
    monthly_trends: monthly,
    customer_trends: customerTrends
      .sort((a, b) => Math.abs(b.change_percentage) - Math.abs(a.change_percentage))
      .slice(0, 20),
    seasonal_patterns: seasonalPatterns,
  };
}

/* ------------------------------------------------------------------ *
 * 5. Risk dashboard
 * ------------------------------------------------------------------ */

export async function getRiskDashboard(companyId) {
  const [behaviour, outstanding, parties] = await Promise.all([
    getPartyPaymentBehaviour({ company: companyId }),
    loadOutstanding(companyId),
    Party.find({ company: companyId, isActive: true })
      .select('name displayName creditLimit balances')
      .lean(),
  ]);

  const partyByKey = new Map(parties.map((p) => [normalisePartyKey(p.name), p]));

  const highRisk = [];
  const creditAlerts = [];

  for (const [key, exposure] of outstanding.byParty) {
    const party = partyByKey.get(key);
    const creditLimit = num(party?.creditLimit?.amount);

    const risk = scoreParty({
      behaviour: behaviour.get(key),
      creditLimit,
      outstanding: exposure.outstanding,
      overdueAmount: exposure.overdueAmount,
      oldestOverdueDays: exposure.oldestOverdueDays,
    });

    if (risk.level === 'High') {
      highRisk.push({
        customer_id: party?.id ? String(party.id) : key,
        customer_name: exposure.partyName,
        risk_score: risk.score,
        risk_level: risk.level,
        outstanding_amount: Math.round(exposure.outstanding),
        factors: risk.factors,
        confidence: risk.confidence,
      });
    }

    const utilisation = creditLimit > 0 ? exposure.outstanding / creditLimit : 0;
    if (creditLimit > 0 && utilisation > 0.8) {
      creditAlerts.push({
        customer_id: party?.id ? String(party.id) : key,
        customer_name: exposure.partyName,
        credit_limit: creditLimit,
        credit_utilization: Number(utilisation.toFixed(4)),
        alert_type: utilisation >= 1 ? 'limit_exceeded' : 'approaching_limit',
      });
    }
  }

  const overduePayments = outstanding.overdueBills
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 50)
    .map((bill) => ({
      payment_id: bill.billRef,
      customer_id: normalisePartyKey(bill.partyName),
      customer_name: bill.partyName,
      amount: Math.round(bill.amount),
      days_overdue: bill.daysOverdue,
      risk_level: bill.daysOverdue > 60 ? 'High' : bill.daysOverdue > 30 ? 'Medium' : 'Low',
    }));

  return {
    high_risk_customers: highRisk.sort((a, b) => b.risk_score - a.risk_score),
    overdue_payments: overduePayments,
    credit_alerts: creditAlerts.sort((a, b) => b.credit_utilization - a.credit_utilization),
    summary: {
      total_high_risk: highRisk.length,
      total_overdue: Math.round(outstanding.totalOverdue),
      total_credit_alerts: creditAlerts.length,
    },
    as_of: outstanding.asOfDate,
  };
}

export default {
  getBusinessMetrics,
  getCustomerInsights,
  getInventoryAnalytics,
  getPaymentTrends,
  getRiskDashboard,
};
