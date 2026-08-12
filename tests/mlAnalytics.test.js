/**
 * Analytics endpoints, driven through fake models holding realistic rows —
 * Tally-shaped JSON columns (totals.grandTotal, inventory.currentStock[],
 * creditLimit.amount) rather than tidy flat fields.
 *
 * The assertions that matter most are the ones about absence: a company with no
 * settled bills, no sales, or no outstanding report must get empty structures,
 * never a number that looks real.
 */

import { jest } from '@jest/globals';

const state = { vouchers: [], parties: [], items: [], bills: [], outstanding: null };

function matches(row, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$in' in cond) return cond.$in.includes(value);
      if ('$gte' in cond) return value != null && new Date(value) >= new Date(cond.$gte);
    }
    return value === cond;
  });
}

const collection = (getRows) => ({
  find: (filter = {}) => {
    const rows = getRows().filter((r) => matches(r, filter));
    const chain = {
      select: () => chain,
      sort: () => chain,
      limit: () => chain,
      lean: async () => rows.map((r) => ({ ...r })),
    };
    return chain;
  },
  findOne: (filter = {}) => {
    const row = getRows().find((r) => matches(r, filter)) || null;
    const chain = { select: () => chain, lean: async () => (row ? { ...row } : null) };
    return chain;
  },
  countDocuments: async (filter = {}) => getRows().filter((r) => matches(r, filter)).length,
});

const mock = (path, getRows, name) =>
  jest.unstable_mockModule(path, () => {
    const model = collection(getRows);
    return { default: model, [name]: model };
  });

mock('../src/models/Voucher.js', () => state.vouchers, 'Voucher');
mock('../src/models/Party.js', () => state.parties, 'Party');
mock('../src/models/Item.js', () => state.items, 'Item');
mock('../src/models/BillHistory.js', () => state.bills, 'BillHistory');
mock(
  '../src/models/OutstandingReceivable.js',
  () => (state.outstanding ? [state.outstanding] : []),
  'OutstandingReceivable'
);

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  getBusinessMetrics,
  getCustomerInsights,
  getInventoryAnalytics,
  getPaymentTrends,
  getRiskDashboard,
} = await import('../src/services/ml/analyticsService.js');

const CO = 'company-1';
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const sale = (partyName, amount, days, items = []) => ({
  company: CO,
  voucherType: 'sales',
  date: daysAgo(days),
  totals: { grandTotal: amount },
  partyName,
  items,
});

const settled = (partyName, daysLate, settledDaysAgo, amount = 1000) => ({
  company: CO,
  reportName: 'Bills Receivable',
  status: 'settled',
  partyName,
  partyKey: partyName.toLowerCase(),
  daysLate,
  settledAt: daysAgo(settledDaysAgo),
  originalAmount: amount,
});

beforeEach(() => {
  state.vouchers = [];
  state.parties = [];
  state.items = [];
  state.bills = [];
  state.outstanding = null;
});

describe('business metrics', () => {
  it('returns zeros and empty structures for a brand new company', async () => {
    const m = await getBusinessMetrics(CO, 30);

    expect(m.revenue_forecast.current_month).toBe(0);
    expect(m.revenue_forecast.next_month).toBe(0);
    expect(m.payment_insights.on_time_percentage).toBe(0);
    expect(m.customer_analytics.total_customers).toBe(0);
    expect(m.inventory_insights.overstock_items).toBe(0);
  });

  it('sums revenue from totals.grandTotal for the current month', async () => {
    state.vouchers = [sale('Sharma Traders', 50000, 1), sale('Sharma Traders', 25000, 2)];

    const m = await getBusinessMetrics(CO, 30);
    expect(m.revenue_forecast.current_month).toBe(75000);
  });

  it('reports on-time percentage from settled bills', async () => {
    state.bills = [
      settled('Sharma Traders', -2, 10),
      settled('Sharma Traders', 12, 20),
      settled('Verma Co', 0, 30),
      settled('Verma Co', 8, 40),
    ];

    const m = await getBusinessMetrics(CO, 30);

    // Two of four settled on or before the due date.
    expect(m.payment_insights.on_time_percentage).toBe(50);
    expect(m.payment_insights.average_delay_days).toBeGreaterThan(0);
  });

  it('counts overdue exposure from the outstanding report', async () => {
    state.outstanding = {
      company: CO,
      reportName: 'Bills Receivable',
      totalOutstanding: 90000,
      asOfDate: new Date(),
      ledgers: [
        {
          partyName: 'Sharma Traders',
          totalOutstanding: 90000,
          oldestOverdueDays: 45,
          bills: [
            { billRef: 'INV-1', closingBalance: 60000, billOverdue: 45 },
            { billRef: 'INV-2', closingBalance: 30000, billOverdue: 0 },
          ],
        },
      ],
    };

    const m = await getBusinessMetrics(CO, 30);
    expect(m.payment_insights.total_overdue).toBe(60000);
  });

  it('does not count an item as overstocked when it never sells', async () => {
    state.items = [
      {
        id: 'i1',
        company: CO,
        isActive: true,
        name: 'Dead Stock Widget',
        inventory: { currentStock: [{ quantity: 5000 }], stockLevels: { reorderLevel: 10 } },
      },
    ];

    const m = await getBusinessMetrics(CO, 30);

    // Huge stock, zero demand: that is dead stock, not overstock.
    expect(m.inventory_insights.overstock_items).toBe(0);
    expect(m.inventory_insights.total_items).toBe(1);
  });
});

describe('customer insights', () => {
  beforeEach(() => {
    state.parties = [
      {
        id: 'p1',
        company: CO,
        isActive: true,
        name: 'Sharma Traders',
        displayName: 'Sharma Traders',
        creditLimit: { amount: 100000 },
        balances: { current: { amount: 80000 } },
        createdAt: daysAgo(400),
      },
    ];
  });

  it('returns null for an unknown customer so the route can 404', async () => {
    expect(await getCustomerInsights(CO, 'Nobody Ltd')).toBeNull();
  });

  it('finds a party by name as well as by id', async () => {
    const byName = await getCustomerInsights(CO, 'sharma traders');
    const byId = await getCustomerInsights(CO, 'p1');

    expect(byName.customer_name).toBe('Sharma Traders');
    expect(byId.customer_name).toBe('Sharma Traders');
  });

  it('reports payment behaviour and credit utilisation', async () => {
    state.bills = [
      settled('Sharma Traders', 10, 20),
      settled('Sharma Traders', 20, 50),
      settled('Sharma Traders', -3, 80),
    ];

    const insights = await getCustomerInsights(CO, 'p1');

    expect(insights.payment_behavior.total_transactions).toBe(3);
    expect(insights.payment_behavior.on_time_percentage).toBeCloseTo(33.3, 0);
    expect(insights.risk_profile.credit_utilization).toBeCloseTo(0.8);
    expect(insights.risk_profile.risk_score).toBeGreaterThan(0);
    expect(insights.factors.length).toBeGreaterThan(0);
  });

  it('keeps confidence low when there is barely any history', async () => {
    state.bills = [settled('Sharma Traders', 10, 20)];
    const insights = await getCustomerInsights(CO, 'p1');

    // Ledger facts are certain; the history half is nearly unevidenced.
    expect(insights.confidence).toBeLessThan(0.75);
    expect(insights.meta.settled_bills).toBe(1);
  });

  it('reports months with no settled bills as null, not 0% on time', async () => {
    state.bills = [settled('Sharma Traders', 5, 10)];
    const insights = await getCustomerInsights(CO, 'p1');

    const withBills = insights.trends.filter((t) => t.bills_settled > 0);
    const withoutBills = insights.trends.filter((t) => t.bills_settled === 0);

    expect(withBills.length).toBe(1);
    expect(withoutBills.every((t) => t.payment_performance === null)).toBe(true);
  });

  it('leaves the credit limit alone without enough history to justify a change', async () => {
    state.vouchers = [sale('Sharma Traders', 50000, 5)];
    state.bills = [settled('Sharma Traders', 2, 10)];

    const insights = await getCustomerInsights(CO, 'p1');
    expect(insights.predictions.recommended_credit_limit).toBe(100000);
  });
});

describe('inventory analytics', () => {
  const widget = {
    id: 'i1',
    company: CO,
    isActive: true,
    name: 'Widget',
    displayName: 'Widget',
    inventory: { currentStock: [{ quantity: 5 }], stockLevels: { reorderLevel: 20 } },
  };

  it('flags stock at or below its reorder level', async () => {
    state.items = [widget];
    state.vouchers = [sale('Sharma Traders', 1000, 10, [{ itemName: 'Widget', quantity: 50 }])];

    const a = await getInventoryAnalytics(CO);

    expect(a.low_stock_items).toHaveLength(1);
    expect(a.low_stock_items[0]).toMatchObject({ item_name: 'Widget', current_stock: 5, reorder_level: 20 });
    // Below the customer's own reorder level, but 50 units a year is ~36 days of
    // cover on 5 in hand — worth ordering, not an emergency.
    expect(a.reorder_recommendations[0].urgency).toBe('medium');
  });

  it('escalates to high urgency when stock runs out within the week', async () => {
    state.items = [widget];
    state.vouchers = [sale('A', 1000, 10, [{ itemName: 'Widget', quantity: 1000 }])];

    const a = await getInventoryAnalytics(CO);

    // ~2.7 units a day against 5 in hand: under two days of cover.
    expect(a.reorder_recommendations[0].urgency).toBe('high');
  });

  it('reads a demand direction from the two 90-day windows', async () => {
    state.items = [widget];
    state.vouchers = [
      sale('A', 1000, 10, [{ itemName: 'Widget', quantity: 100 }]),
      sale('A', 1000, 120, [{ itemName: 'Widget', quantity: 20 }]),
    ];

    const a = await getInventoryAnalytics(CO);
    expect(a.demand_trends[0].trend).toBe('increasing');
  });

  it('returns empty lists when nothing has ever sold', async () => {
    state.items = [widget];

    const a = await getInventoryAnalytics(CO);

    expect(a.total_items).toBe(1);
    expect(a.demand_trends).toEqual([]);
    expect(a.reorder_recommendations).toEqual([]);
  });
});

describe('payment trends', () => {
  it('buckets settled bills by month with on-time and delayed counts', async () => {
    state.bills = [settled('A', 5, 10), settled('A', -1, 12), settled('B', 30, 15)];

    const t = await getPaymentTrends(CO);

    // Bills a fortnight apart can straddle a month boundary, so assert on the
    // totals across buckets rather than assuming they land in one.
    const sum = (field) => t.monthly_trends.reduce((n, b) => n + b[field], 0);

    expect(sum('total_payments')).toBe(3);
    expect(sum('on_time_payments')).toBe(1);
    expect(sum('delayed_payments')).toBe(2);
    expect(t.monthly_trends.every((b) => b.average_delay_days >= 0)).toBe(true);
  });

  it('reads a falling delay as improving', async () => {
    state.bills = [
      settled('Sharma', 30, 150),
      settled('Sharma', 28, 140),
      settled('Sharma', 3, 20),
      settled('Sharma', 2, 10),
    ];

    const t = await getPaymentTrends(CO);
    const trend = t.customer_trends.find((c) => c.customer_name === 'Sharma');

    expect(trend.trend).toBe('improving');
  });

  it('returns empty structures with no history at all', async () => {
    const t = await getPaymentTrends(CO);
    expect(t.monthly_trends).toEqual([]);
    expect(t.customer_trends).toEqual([]);
    expect(t.seasonal_patterns).toEqual([]);
  });
});

describe('risk dashboard', () => {
  beforeEach(() => {
    state.parties = [
      {
        id: 'p1',
        company: CO,
        isActive: true,
        name: 'Late Payer Ltd',
        creditLimit: { amount: 100000 },
        balances: { current: { amount: 95000 } },
      },
    ];
    state.outstanding = {
      company: CO,
      reportName: 'Bills Receivable',
      totalOutstanding: 95000,
      asOfDate: new Date(),
      ledgers: [
        {
          partyName: 'Late Payer Ltd',
          totalOutstanding: 95000,
          oldestOverdueDays: 70,
          bills: [{ billRef: 'INV-7', closingBalance: 95000, billOverdue: 70 }],
        },
      ],
    };
  });

  it('surfaces a chronic late payer with the factors behind the score', async () => {
    state.bills = [
      settled('Late Payer Ltd', 40, 30),
      settled('Late Payer Ltd', 35, 60),
      settled('Late Payer Ltd', 50, 90),
    ];

    const d = await getRiskDashboard(CO);

    expect(d.summary.total_high_risk).toBe(1);
    expect(d.high_risk_customers[0].customer_name).toBe('Late Payer Ltd');
    expect(d.high_risk_customers[0].factors.length).toBeGreaterThan(0);
    expect(d.overdue_payments[0]).toMatchObject({ payment_id: 'INV-7', days_overdue: 70 });
    expect(d.summary.total_credit_alerts).toBe(1);
  });

  it('does not call a party high risk on credit utilisation alone', async () => {
    // No payment history: 95% utilisation and one overdue bill should worry, but
    // not enough to condemn a customer who may simply be new.
    const d = await getRiskDashboard(CO);

    expect(d.summary.total_high_risk).toBe(0);
    expect(d.summary.total_credit_alerts).toBe(1);
  });

  it('is empty when Tally has sent no outstanding report yet', async () => {
    state.outstanding = null;

    const d = await getRiskDashboard(CO);

    expect(d.high_risk_customers).toEqual([]);
    expect(d.overdue_payments).toEqual([]);
    expect(d.summary.total_overdue).toBe(0);
  });
});
