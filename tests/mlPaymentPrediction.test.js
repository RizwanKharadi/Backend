/**
 * Payment delay prediction and risk assessment.
 *
 * Beyond the maths, two behaviours are pinned here deliberately: that a bulk call
 * loads the company once instead of per customer (the old service issued three
 * queries per party), and that a party nobody has any history for is not handed a
 * confident prediction.
 */

import { jest } from '@jest/globals';

const state = { parties: [], bills: [], outstanding: null };
const queryCounts = { party: 0, bill: 0, outstanding: 0 };

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

const collection = (getRows, counterKey) => ({
  find: (filter = {}) => {
    queryCounts[counterKey] += 1;
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
    queryCounts[counterKey] += 1;
    const row = getRows().find((r) => matches(r, filter)) || null;
    const chain = { select: () => chain, lean: async () => (row ? { ...row } : null) };
    return chain;
  },
  countDocuments: async (filter = {}) => getRows().filter((r) => matches(r, filter)).length,
});

const mock = (path, getRows, name, counterKey) =>
  jest.unstable_mockModule(path, () => {
    const model = collection(getRows, counterKey);
    return { default: model, [name]: model };
  });

mock('../src/models/Party.js', () => state.parties, 'Party', 'party');
mock('../src/models/BillHistory.js', () => state.bills, 'BillHistory', 'bill');
mock(
  '../src/models/OutstandingReceivable.js',
  () => (state.outstanding ? [state.outstanding] : []),
  'OutstandingReceivable',
  'outstanding'
);

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { predictPaymentDelay, predictPaymentDelayBulk, assessCustomerRisk } = await import(
  '../src/services/ml/paymentPrediction.js'
);

const CO = 'company-1';
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const party = (id, name, limit, balance) => ({
  id,
  company: CO,
  isActive: true,
  name,
  displayName: name,
  creditLimit: { amount: limit },
  balances: { current: { amount: balance } },
});

const settled = (name, daysLate, ago) => ({
  company: CO,
  reportName: 'Bills Receivable',
  status: 'settled',
  partyName: name,
  partyKey: name.toLowerCase(),
  daysLate,
  settledAt: daysAgo(ago),
  originalAmount: 1000,
});

const outstandingFor = (rows) => ({
  company: CO,
  reportName: 'Bills Receivable',
  asOfDate: new Date(),
  ledgers: rows.map(({ name, total, overdue = 0, oldest = 0 }) => ({
    partyName: name,
    totalOutstanding: total,
    oldestOverdueDays: oldest,
    bills: [
      { billRef: `${name}-1`, closingBalance: overdue, billOverdue: oldest || (overdue ? 30 : 0) },
      { billRef: `${name}-2`, closingBalance: total - overdue, billOverdue: 0 },
    ],
  })),
});

beforeEach(() => {
  state.parties = [];
  state.bills = [];
  state.outstanding = null;
  queryCounts.party = 0;
  queryCounts.bill = 0;
  queryCounts.outstanding = 0;
});

describe('predictPaymentDelay', () => {
  beforeEach(() => {
    state.parties = [party('p1', 'Sharma Traders', 100000, 40000)];
    state.outstanding = outstandingFor([{ name: 'Sharma Traders', total: 40000 }]);
  });

  it('returns null for a customer nobody has heard of', async () => {
    expect(await predictPaymentDelay(CO, { customerId: 'Ghost Ltd' })).toBeNull();
  });

  it('predicts from the party own median delay', async () => {
    state.bills = [
      settled('Sharma Traders', 10, 30),
      settled('Sharma Traders', 20, 60),
      settled('Sharma Traders', 14, 90),
    ];

    const p = await predictPaymentDelay(CO, { customerId: 'p1' });

    expect(p.predicted_delay_days).toBe(14);
    expect(p.meta.basis).toBe('party_history');
    expect(p.delay_probability).toBeGreaterThan(0);
    expect(p.risk_level).toMatch(/Low|Medium|High/);
  });

  it('returns factors as a name to number map for the chip list', async () => {
    state.bills = [settled('Sharma Traders', 30, 30), settled('Sharma Traders', 40, 60)];

    const p = await predictPaymentDelay(CO, { customerId: 'p1' });

    expect(Array.isArray(p.factors)).toBe(false);
    for (const value of Object.values(p.factors)) {
      expect(typeof value).toBe('number');
    }
  });

  it('falls back to the company median when the party has no history', async () => {
    state.parties.push(party('p2', 'New Customer', 50000, 10000));
    state.bills = [settled('Sharma Traders', 12, 30), settled('Sharma Traders', 18, 60)];

    const p = await predictPaymentDelay(CO, { customerId: 'p2' });

    expect(p.meta.basis).toBe('company_average');
    expect(p.predicted_delay_days).toBe(15);
    expect(p.meta.settled_bills).toBe(0);
  });

  it('claims nothing when nobody in the company has ever settled a bill', async () => {
    const p = await predictPaymentDelay(CO, { customerId: 'p1' });

    expect(p.meta.basis).toBe('no_history');
    expect(p.predicted_delay_days).toBe(0);
    // No history means the score rests only on ledger facts.
    expect(p.confidence_score).toBeLessThan(1);
  });

  it('flags a proposed invoice that would breach the credit limit', async () => {
    const p = await predictPaymentDelay(CO, { customerId: 'p1', amount: 80000 });

    expect(p.meta.projected_outstanding).toBe(120000);
    expect(p.factors['Would exceed credit limit']).toBeGreaterThan(0);
  });

  it('does not flag an invoice that stays within the limit', async () => {
    const p = await predictPaymentDelay(CO, { customerId: 'p1', amount: 10000 });
    expect(p.factors['Would exceed credit limit']).toBeUndefined();
  });

  it('scores a party that exists only on the outstanding report', async () => {
    // Bills identify parties by name, so Tally can owe us against a name with no
    // party row synced yet.
    state.outstanding = outstandingFor([
      { name: 'Sharma Traders', total: 40000 },
      { name: 'Unsynced Party', total: 25000, overdue: 25000, oldest: 40 },
    ]);

    const p = await predictPaymentDelay(CO, { customerId: 'Unsynced Party' });

    expect(p).not.toBeNull();
    expect(p.customer_name).toBe('Unsynced Party');
    expect(p.meta.outstanding).toBe(25000);
  });
});

describe('predictPaymentDelayBulk', () => {
  beforeEach(() => {
    state.parties = [
      party('p1', 'Good Payer', 100000, 20000),
      party('p2', 'Late Payer', 100000, 95000),
      party('p3', 'Quiet Co', 50000, 5000),
    ];
    state.outstanding = outstandingFor([
      { name: 'Good Payer', total: 20000 },
      { name: 'Late Payer', total: 95000, overdue: 95000, oldest: 75 },
      { name: 'Quiet Co', total: 5000 },
    ]);
    state.bills = [
      settled('Good Payer', -2, 20),
      settled('Good Payer', 0, 50),
      settled('Late Payer', 45, 20),
      settled('Late Payer', 55, 50),
      settled('Late Payer', 40, 80),
    ];
  });

  it('scores everyone with exposure when no ids are given', async () => {
    const result = await predictPaymentDelayBulk(CO, {});

    expect(result.predictions).toHaveLength(3);
    expect(result.summary.successful_predictions).toBe(3);
    expect(result.summary.high_risk_customers).toBeGreaterThanOrEqual(1);
  });

  it('sorts riskiest first so the collections list is actionable', async () => {
    const result = await predictPaymentDelayBulk(CO, {});

    expect(result.predictions[0].customer_name).toBe('Late Payer');
    const probabilities = result.predictions.map((p) => p.delay_probability);
    expect([...probabilities].sort((a, b) => b - a)).toEqual(probabilities);
  });

  it('loads the company once rather than once per customer', async () => {
    await predictPaymentDelayBulk(CO, {});

    // Three parties scored; the old service would have issued three queries each.
    expect(queryCounts.party).toBe(1);
    expect(queryCounts.outstanding).toBe(1);
    expect(queryCounts.bill).toBe(2); // behaviour summary + company median
  });

  it('skips ids that match nothing instead of failing the whole batch', async () => {
    const result = await predictPaymentDelayBulk(CO, {
      customerIds: ['p1', 'Ghost Ltd', 'p2'],
    });

    expect(result.summary.total_customers).toBe(3);
    expect(result.summary.successful_predictions).toBe(2);
  });

  it('returns an empty batch rather than throwing when there is no data', async () => {
    state.parties = [];
    state.outstanding = null;
    state.bills = [];

    const result = await predictPaymentDelayBulk(CO, {});

    expect(result.predictions).toEqual([]);
    expect(result.summary.average_delay_probability).toBe(0);
  });
});

describe('assessCustomerRisk', () => {
  beforeEach(() => {
    state.parties = [party('p1', 'Late Payer', 100000, 95000)];
    state.outstanding = outstandingFor([
      { name: 'Late Payer', total: 95000, overdue: 95000, oldest: 75 },
    ]);
    state.bills = [
      settled('Late Payer', 45, 20),
      settled('Late Payer', 55, 50),
      settled('Late Payer', 40, 80),
    ];
  });

  it('returns null for an unknown customer', async () => {
    expect(await assessCustomerRisk(CO, 'Ghost Ltd')).toBeNull();
  });

  it('gives factors with numeric impact and a description, as the screen expects', async () => {
    const a = await assessCustomerRisk(CO, 'p1', 'overall');

    expect(Array.isArray(a.risk_factors)).toBe(true);
    for (const f of a.risk_factors) {
      expect(typeof f.impact).toBe('number');
      expect(typeof f.description).toBe('string');
      expect(f.factor).toBeTruthy();
    }
    expect(a.recommendations.length).toBeGreaterThan(0);
  });

  it('scores payment mode against payment history alone', async () => {
    const payment = await assessCustomerRisk(CO, 'p1', 'payment');

    // Chronically late: on a payment-only scale that must read high, not be
    // capped by the weight those signals carry inside the overall blend.
    expect(payment.risk_level).toBe('High');
    expect(payment.risk_factors.every((f) => !f.factor.includes('Credit utilisation'))).toBe(true);
    expect(payment.assessment_type).toBe('payment');
  });

  it('ignores payment history in credit mode', async () => {
    const credit = await assessCustomerRisk(CO, 'p1', 'credit');

    expect(credit.risk_factors.every((f) => f.factor !== 'Late payment history')).toBe(true);
    // Ledger facts need no history to be trusted.
    expect(credit.confidence).toBe(1);
  });

  it('falls back to overall for an unrecognised assessment type', async () => {
    const a = await assessCustomerRisk(CO, 'p1', 'nonsense');
    expect(a.assessment_type).toBe('overall');
  });

  it('does not condemn a party on utilisation alone in overall mode', async () => {
    state.bills = [];

    const a = await assessCustomerRisk(CO, 'p1', 'overall');

    // 95% utilisation and an overdue bill, but nothing is known about how they
    // pay — a new customer looks exactly like this.
    expect(a.risk_level).not.toBe('High');
    expect(a.meta.settled_bills).toBe(0);
  });
});
