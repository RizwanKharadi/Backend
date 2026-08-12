/**
 * Bill history lifecycle: a bill appears in the outstanding report, is refreshed
 * across syncs, then disappears once paid.
 *
 * The service is mocked against an in-memory store rather than MySQL so the diff
 * logic — especially the guards that decide when NOT to settle — is testable
 * without a live database.
 */

import { jest } from '@jest/globals';

const store = { rows: [] };

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

const BillHistoryMock = {
  find: (filter = {}) => {
    const rows = store.rows.filter((r) => matches(r, filter));
    return { lean: async () => rows.map((r) => ({ ...r })) };
  },
  insertMany: async (docs = []) => {
    docs.forEach((doc, i) => store.rows.push({ id: `row-${store.rows.length + i}`, ...doc }));
    return docs;
  },
  updateMany: async (filter, update) => {
    const set = update.$set || {};
    let n = 0;
    for (const row of store.rows) {
      if (matches(row, filter)) {
        Object.assign(row, set);
        n += 1;
      }
    }
    return { modifiedCount: n };
  },
};

jest.unstable_mockModule('../src/models/BillHistory.js', () => ({
  default: BillHistoryMock,
  BillHistory: BillHistoryMock,
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { recordBillSnapshot, getPartyPaymentBehaviour } = await import(
  '../src/services/billHistoryService.js'
);

const COMPANY = 'company-1';
const day = (n) => new Date(Date.UTC(2026, 0, n));

const snapshot = (bills) => [
  {
    partyName: 'Sharma Traders',
    totalOutstanding: bills.reduce((s, b) => s + b.closingBalance, 0),
    bills,
  },
];

const bill = (ref, balance, dueDay) => ({
  billRef: ref,
  billDate: day(1),
  billDue: day(dueDay),
  closingBalance: balance,
  vchType: 'Sales',
  vchNumber: ref,
});

beforeEach(() => {
  store.rows = [];
});

describe('recordBillSnapshot', () => {
  it('creates history rows for bills seen for the first time', async () => {
    const result = await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10), bill('INV-2', 3000, 20)]),
      asOfDate: day(5),
    });

    expect(result.created).toBe(2);
    expect(result.settled).toBe(0);
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]).toMatchObject({
      company: COMPANY,
      partyName: 'Sharma Traders',
      billRef: 'INV-1',
      originalAmount: 5000,
      status: 'open',
    });
  });

  it('settles a bill once it stops appearing, dating it from the snapshot', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10), bill('INV-2', 3000, 20)]),
      asOfDate: day(5),
    });

    // INV-1 paid; it drops out of Tally's outstanding report.
    const result = await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-2', 3000, 20)]),
      asOfDate: day(25),
    });

    expect(result.settled).toBe(1);

    const settled = store.rows.find((r) => r.billRef === 'INV-1');
    expect(settled.status).toBe('settled');
    expect(settled.settledAt).toEqual(day(25));
    // Due on the 10th, gone by the 25th → 15 days late.
    expect(settled.daysLate).toBe(15);

    expect(store.rows.find((r) => r.billRef === 'INV-2').status).toBe('open');
  });

  it('records early payment as a negative delay', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-9', 1000, 28)]),
      asOfDate: day(5),
    });
    await recordBillSnapshot({ company: COMPANY, ledgers: snapshot([]), asOfDate: day(20) });

    // Empty snapshot must not settle it — see the guard test below. Give it a
    // real snapshot with a different bill instead.
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-10', 500, 28)]),
      asOfDate: day(20),
    });

    expect(store.rows.find((r) => r.billRef === 'INV-9').daysLate).toBe(-8);
  });

  it('tracks partial payment without settling the bill', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10)]),
      asOfDate: day(5),
    });
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 2000, 10)]),
      asOfDate: day(9),
    });

    const row = store.rows.find((r) => r.billRef === 'INV-1');
    expect(row.status).toBe('open');
    expect(row.lastSeenBalance).toBe(2000);
    // The full value of the bill is retained even after part payment.
    expect(row.originalAmount).toBe(5000);
  });

  it('ignores an empty snapshot rather than settling everything', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10)]),
      asOfDate: day(5),
    });

    const result = await recordBillSnapshot({ company: COMPANY, ledgers: [], asOfDate: day(9) });

    expect(result.skipped).toBe('empty-snapshot');
    expect(store.rows.find((r) => r.billRef === 'INV-1').status).toBe('open');
  });

  it('ignores a snapshot older than one already processed', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10)]),
      asOfDate: day(20),
    });

    // Desktop agent replays an older report after a reconnect.
    const result = await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-2', 1000, 10)]),
      asOfDate: day(6),
    });

    expect(result.skipped).toBe('stale-snapshot');
    expect(store.rows).toHaveLength(1);
  });

  it('reopens a settled bill if it comes back after a Tally edit', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10), bill('INV-2', 100, 10)]),
      asOfDate: day(5),
    });
    await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-2', 100, 10)]),
      asOfDate: day(15),
    });
    expect(store.rows.find((r) => r.billRef === 'INV-1').status).toBe('settled');

    const result = await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('INV-1', 5000, 10), bill('INV-2', 100, 10)]),
      asOfDate: day(18),
    });

    expect(result.reopened).toBe(1);
    const row = store.rows.find((r) => r.billRef === 'INV-1');
    expect(row.status).toBe('open');
    expect(row.settledAt).toBeNull();
    expect(row.daysLate).toBeNull();
  });

  it('skips bills with no reference, which have no stable identity', async () => {
    const result = await recordBillSnapshot({
      company: COMPANY,
      ledgers: snapshot([bill('', 900, 10), bill('INV-3', 400, 10)]),
      asOfDate: day(5),
    });

    expect(result.created).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].billRef).toBe('INV-3');
  });

  it('keeps receivable and payable bills apart', async () => {
    await recordBillSnapshot({
      company: COMPANY,
      reportName: 'Bills Receivable',
      ledgers: snapshot([bill('INV-1', 5000, 10)]),
      asOfDate: day(5),
    });

    // A payables sync must not look like "the receivable disappeared".
    const result = await recordBillSnapshot({
      company: COMPANY,
      reportName: 'Bills Payable',
      ledgers: snapshot([bill('PUR-1', 2000, 10)]),
      asOfDate: day(6),
    });

    expect(result.settled).toBe(0);
    expect(store.rows.find((r) => r.billRef === 'INV-1').status).toBe('open');
  });

  it('never throws when the store fails', async () => {
    const boom = jest.spyOn(BillHistoryMock, 'find').mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(
      recordBillSnapshot({
        company: COMPANY,
        ledgers: snapshot([bill('INV-1', 5000, 10)]),
        asOfDate: day(5),
      })
    ).resolves.toMatchObject({ skipped: 'error' });

    boom.mockRestore();
  });
});

describe('getPartyPaymentBehaviour', () => {
  it('summarises how a party pays, with confidence scaled to history depth', async () => {
    store.rows = [
      { company: COMPANY, reportName: 'Bills Receivable', partyKey: 'sharma traders', partyName: 'Sharma Traders', status: 'settled', settledAt: day(20), daysLate: 10, originalAmount: 1000 },
      { company: COMPANY, reportName: 'Bills Receivable', partyKey: 'sharma traders', partyName: 'Sharma Traders', status: 'settled', settledAt: day(21), daysLate: 20, originalAmount: 2000 },
      { company: COMPANY, reportName: 'Bills Receivable', partyKey: 'sharma traders', partyName: 'Sharma Traders', status: 'settled', settledAt: day(22), daysLate: -5, originalAmount: 3000 },
      { company: COMPANY, reportName: 'Bills Receivable', partyKey: 'sharma traders', partyName: 'Sharma Traders', status: 'open', daysLate: null, originalAmount: 9000 },
    ];

    const behaviour = await getPartyPaymentBehaviour({ company: COMPANY });
    const stats = behaviour.get('sharma traders');

    expect(stats.settledCount).toBe(3);
    expect(stats.lateCount).toBe(2);
    expect(stats.lateRatio).toBeCloseTo(2 / 3);
    expect(stats.medianDaysLate).toBe(10);
    expect(stats.worstDaysLate).toBe(20);
    expect(stats.totalSettled).toBe(6000);
    // Three settled bills is thin evidence, and the score should say so.
    expect(stats.confidence).toBeCloseTo(0.3);
  });

  it('returns nothing for a company with no settled history yet', async () => {
    store.rows = [];
    const behaviour = await getPartyPaymentBehaviour({ company: COMPANY });
    expect(behaviour.size).toBe(0);
  });
});
