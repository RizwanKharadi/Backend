/**
 * Insight cache: fast, but never serving a figure built from data that has since
 * changed. Staleness against the clock is acceptable; staleness against Tally is
 * not, because the whole product promise is that the numbers reconcile.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { withCache, bumpCompanyVersion, clearCompany, resetCache, cacheStats } = await import(
  '../src/services/ml/cache.js'
);

beforeEach(() => resetCache());

describe('withCache', () => {
  it('computes once and serves the held value after that', async () => {
    const compute = jest.fn(async () => ({ n: 1 }));

    const a = await withCache('co1', 'report', compute);
    const b = await withCache('co1', 'report', compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it('keeps companies apart', async () => {
    await withCache('co1', 'report', async () => 'first');
    const other = await withCache('co2', 'report', async () => 'second');

    expect(other).toBe('second');
  });

  it('treats different parameters as different reports', async () => {
    const compute = jest.fn(async () => 'x');

    await withCache('co1', 'business-metrics:30', compute);
    await withCache('co1', 'business-metrics:90', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('recomputes once the company data changes', async () => {
    const compute = jest.fn(async () => 'value');

    await withCache('co1', 'report', compute);
    bumpCompanyVersion('co1');
    await withCache('co1', 'report', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('is not invalidated by another company syncing', async () => {
    const compute = jest.fn(async () => 'value');

    await withCache('co1', 'report', compute);
    bumpCompanyVersion('co2');
    await withCache('co1', 'report', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes after the entry expires', async () => {
    const compute = jest.fn(async () => 'value');

    await withCache('co1', 'report', compute, { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await withCache('co1', 'report', compute, { ttlMs: 1 });

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('does not hold a value when the computation fails', async () => {
    const boom = jest.fn(async () => {
      throw new Error('nope');
    });

    await expect(withCache('co1', 'report', boom)).rejects.toThrow('nope');
    expect(cacheStats().entries).toBe(0);
  });
});

describe('clearCompany', () => {
  it('drops that company entries and leaves others alone', async () => {
    await withCache('co1', 'a', async () => 1);
    await withCache('co1', 'b', async () => 2);
    await withCache('co2', 'a', async () => 3);

    clearCompany('co1');

    const compute = jest.fn(async () => 99);
    await withCache('co1', 'a', compute);
    expect(compute).toHaveBeenCalledTimes(1);

    const untouched = jest.fn(async () => 99);
    await withCache('co2', 'a', untouched);
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe('memory ceiling', () => {
  it('stops growing once the entry limit is reached', async () => {
    for (let i = 0; i < 700; i += 1) {
      await withCache('co1', `report-${i}`, async () => i);
    }

    expect(cacheStats().entries).toBeLessThanOrEqual(500);
  });
});
