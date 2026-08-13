/**
 * Guards the column names the insight services read.
 *
 * Naming a column the table does not have fails at query time, not at startup,
 * so it shows up as a 500 on a live endpoint rather than a broken build. That is
 * exactly what happened: `loadSalesVouchers` selected `amount`, which does not
 * exist on `vouchers`, and took out business-metrics, customer-insights,
 * inventory-analytics and inventory-forecast in production at once.
 *
 * The unit tests could not catch it because their fake models treat `.select()`
 * as a no-op, so every field "exists". This checks the real model definition
 * instead — no database connection required, since defining models does not need
 * one.
 */

import { jest } from '@jest/globals';
import { Sequelize } from 'sequelize';
import { defineAllModels } from '../src/db/defineModels.js';

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { SALES_VOUCHER_FIELDS, SALES_VOUCHER_ITEM_FIELD, voucherAmount, itemStock } = await import(
  '../src/services/ml/dataAccess.js'
);

const sequelize = new Sequelize('db', 'user', 'pass', { dialect: 'mysql', logging: false });
const { sequelizeModels } = defineAllModels(sequelize);

describe('columns read from vouchers', () => {
  const columns = Object.keys(sequelizeModels.Voucher.rawAttributes);

  it.each([...SALES_VOUCHER_FIELDS, SALES_VOUCHER_ITEM_FIELD])(
    'vouchers.%s exists on the model',
    (field) => {
      expect(columns).toContain(field);
    }
  );

  it('does not read a flat amount column, because there is not one', () => {
    expect(columns).not.toContain('amount');
    expect(SALES_VOUCHER_FIELDS).not.toContain('amount');
  });
});

describe('voucherAmount', () => {
  it('reads the value out of the totals JSON', () => {
    expect(voucherAmount({ totals: { grandTotal: 1500.5 } })).toBe(1500.5);
  });

  it('treats a credit note style negative as its magnitude', () => {
    expect(voucherAmount({ totals: { grandTotal: -2000 } })).toBe(2000);
  });

  it('is zero when totals are missing rather than throwing', () => {
    expect(voucherAmount({})).toBe(0);
    expect(voucherAmount(null)).toBe(0);
    expect(voucherAmount({ totals: {} })).toBe(0);
  });
});

describe('itemStock', () => {
  it('sums stock held across godowns', () => {
    expect(
      itemStock({ inventory: { currentStock: [{ quantity: 10 }, { availableQuantity: 5 }] } })
    ).toBe(15);
  });

  it('is zero when Tally sent something other than a list', () => {
    // voucherController defends against exactly this, so the data really can
    // arrive in that shape.
    expect(itemStock({ inventory: { currentStock: { quantity: 10 } } })).toBe(0);
    expect(itemStock({ inventory: {} })).toBe(0);
    expect(itemStock({})).toBe(0);
  });
});
