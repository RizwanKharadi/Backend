/**
 * Inventory demand forecasting.
 *
 * The assertions worth reading are the ones about restraint: a slow mover must
 * not be scaled up to a fast one, a curve must not be invented from thin history,
 * and an item that has never sold must not produce a reorder.
 */

import { jest } from '@jest/globals';

const state = { items: [], vouchers: [] };

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
});

jest.unstable_mockModule('../src/models/Item.js', () => {
  const model = collection(() => state.items);
  return { default: model, Item: model };
});

jest.unstable_mockModule('../src/models/Voucher.js', () => {
  const model = collection(() => state.vouchers);
  return { default: model, Voucher: model };
});

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { forecastInventoryDemand } = await import('../src/services/ml/inventoryForecast.js');

const CO = 'company-1';
const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

const item = (id, name, stock, reorder = 0, leadTime = 7) => ({
  id,
  company: CO,
  isActive: true,
  name,
  displayName: name,
  inventory: {
    currentStock: [{ quantity: stock }],
    stockLevels: { reorderLevel: reorder },
    leadTimeDays: leadTime,
  },
});

/** One sale line, `ago` days back. */
const sale = (itemName, qty, ago) => ({
  company: CO,
  voucherType: 'sales',
  date: daysAgo(ago),
  totals: { grandTotal: qty * 100 },
  items: [{ itemName, quantity: qty }],
});

/** `count` evenly spaced sales across the last `spanDays`. */
const steadySales = (itemName, qty, count, spanDays) =>
  Array.from({ length: count }, (_, i) =>
    sale(itemName, qty, Math.round((i * spanDays) / count) + 1)
  );

beforeEach(() => {
  state.items = [];
  state.vouchers = [];
});

describe('demand rate', () => {
  it('divides by the whole observation window, not just days that had a sale', async () => {
    state.items = [item('i1', 'Slow Widget', 100)];
    // 12 sales of 1 unit spread across a year: about 1 a month, not 1 a day.
    state.vouchers = steadySales('Slow Widget', 1, 12, 360);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    expect(f.meta.daily_demand).toBeLessThan(0.1);
    expect(f.meta.horizon_demand).toBeLessThan(5);
  });

  it('does not treat a newly introduced item as a slow mover', async () => {
    state.items = [item('i1', 'New Widget', 50)];
    // 30 units in the last three weeks only.
    state.vouchers = steadySales('New Widget', 3, 10, 21);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    // Measured over its short life, not diluted across a year it did not exist for.
    expect(f.meta.observation_days).toBeLessThanOrEqual(30);
    expect(f.meta.daily_demand).toBeGreaterThan(0.5);
  });

  it('forecasts zero for an item that has never sold', async () => {
    state.items = [item('i1', 'Dead Widget', 500)];

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 10 });

    expect(f.meta.daily_demand).toBe(0);
    expect(f.predicted_demand.every((d) => d.predicted_demand === 0)).toBe(true);
    expect(f.reorder_recommendation.should_reorder).toBe(false);
    expect(f.reorder_recommendation.reason).toMatch(/no sales/i);
  });
});

describe('seasonality', () => {
  it('is skipped when there is too little history to measure it', async () => {
    state.items = [item('i1', 'Widget', 100)];
    state.vouchers = steadySales('Widget', 5, 8, 40);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    expect(f.meta.seasonality_applied).toBe(false);
    // Flat rate: every day identical.
    const values = new Set(f.predicted_demand.map((d) => d.predicted_demand));
    expect(values.size).toBe(1);
  });

  it('can be turned off explicitly even with plenty of history', async () => {
    state.items = [item('i1', 'Widget', 100)];
    state.vouchers = steadySales('Widget', 5, 200, 360);

    const [f] = await forecastInventoryDemand(CO, {
      itemIds: ['i1'],
      daysAhead: 60,
      includeSeasonality: false,
    });

    expect(f.meta.seasonality_applied).toBe(false);
  });

  it('applies measured factors when the year is well covered', async () => {
    state.items = [item('i1', 'Widget', 100)];
    state.vouchers = steadySales('Widget', 5, 200, 360);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 90 });

    expect(f.meta.seasonality_applied).toBe(true);
  });
});

describe('confidence', () => {
  it('is never the same constant for every item', async () => {
    state.items = [item('i1', 'Steady', 100), item('i2', 'Lumpy', 100)];
    state.vouchers = [
      ...steadySales('Steady', 5, 100, 300),
      sale('Lumpy', 200, 5),
      sale('Lumpy', 1, 200),
    ];

    const results = await forecastInventoryDemand(CO, { daysAhead: 30 });
    const steady = results.find((r) => r.item_name === 'Steady');
    const lumpy = results.find((r) => r.item_name === 'Lumpy');

    expect(steady.confidence_score).not.toBe(lumpy.confidence_score);
    // A regular seller is more forecastable than two scattered sales.
    expect(steady.confidence_score).toBeGreaterThan(lumpy.confidence_score);
  });

  it('stays low for an item with almost no sales and never reaches certainty', async () => {
    state.items = [item('i1', 'Widget', 10)];
    state.vouchers = [sale('Widget', 1, 30)];

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    expect(f.confidence_score).toBeLessThan(0.5);
    expect(f.confidence_score).toBeLessThanOrEqual(0.9);
  });
});

describe('reorder recommendation', () => {
  it('recommends reordering when stock is at or below the reorder point', async () => {
    state.items = [item('i1', 'Widget', 10, 20, 7)];
    state.vouchers = steadySales('Widget', 5, 60, 180);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    expect(f.reorder_recommendation.should_reorder).toBe(true);
    expect(f.reorder_recommendation.recommended_quantity).toBeGreaterThan(0);
    expect(f.reorder_recommendation.reason).toMatch(/reorder point/i);
  });

  it('projects when to reorder instead when stock is comfortable', async () => {
    state.items = [item('i1', 'Widget', 5000, 20, 7)];
    state.vouchers = steadySales('Widget', 5, 60, 180);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    expect(f.reorder_recommendation.should_reorder).toBe(false);
    expect(f.reorder_recommendation.recommended_quantity).toBe(0);
    expect(new Date(f.reorder_recommendation.reorder_date).getTime()).toBeGreaterThan(Date.now());
  });

  it('respects the customer own reorder level as safety stock', async () => {
    state.items = [item('i1', 'Widget', 10, 500, 7)];
    state.vouchers = steadySales('Widget', 5, 60, 180);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 30 });

    // Their level of 500 dominates the formula's own safety margin.
    expect(f.reorder_recommendation.recommended_quantity).toBeGreaterThan(500);
  });

  it('can be omitted entirely', async () => {
    state.items = [item('i1', 'Widget', 10, 20)];
    state.vouchers = steadySales('Widget', 5, 60, 180);

    const [f] = await forecastInventoryDemand(CO, {
      itemIds: ['i1'],
      includeRecommendations: false,
    });

    expect(f.reorder_recommendation).toBeUndefined();
    expect(f.predicted_demand.length).toBeGreaterThan(0);
  });
});

describe('selection and limits', () => {
  it('accepts an item name as well as an id', async () => {
    state.items = [item('i1', 'Widget', 10)];
    state.vouchers = steadySales('Widget', 5, 20, 100);

    const [byName] = await forecastInventoryDemand(CO, { itemIds: ['widget'] });
    expect(byName.item_name).toBe('Widget');
  });

  it('accepts the display name the app and the picker show', async () => {
    // inventoryService lists items by displayName, so that is what comes back
    // from the picker — matching only the stored name would find nothing.
    const widget = item('i1', 'WIDGET-STD-01', 10);
    widget.displayName = 'Standard Widget';
    state.items = [widget];
    state.vouchers = steadySales('WIDGET-STD-01', 5, 20, 100);

    const [found] = await forecastInventoryDemand(CO, { itemIds: ['Standard Widget'] });

    expect(found).toBeDefined();
    expect(found.item_name).toBe('Standard Widget');
  });

  it('returns the busiest items, capped, when nothing is selected', async () => {
    state.items = Array.from({ length: 80 }, (_, i) => item(`i${i}`, `Item ${i}`, 100));
    state.vouchers = [sale('Item 79', 500, 5), sale('Item 3', 100, 5)];

    const results = await forecastInventoryDemand(CO, { daysAhead: 5 });

    expect(results).toHaveLength(50);
    expect(results[0].item_name).toBe('Item 79');
  });

  it('clamps the horizon to a year', async () => {
    state.items = [item('i1', 'Widget', 10)];
    state.vouchers = steadySales('Widget', 5, 20, 100);

    const [f] = await forecastInventoryDemand(CO, { itemIds: ['i1'], daysAhead: 9000 });
    expect(f.predicted_demand).toHaveLength(365);
  });

  it('returns an empty list when the company has no items', async () => {
    expect(await forecastInventoryDemand(CO, {})).toEqual([]);
  });
});
