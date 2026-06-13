const {
  mapItemVoucherPayload,
  mapLedgerPayload,
  mapStockItemPayload,
  buildItemLedgerEntries
} = require('../tallySyncTsImportMapper');

describe('tallySyncTsImportMapper', () => {
  test('maps sales voucher with party and tax ledgers', () => {
    const voucher = mapItemVoucherPayload({
      vchType: 'Sales',
      date: '2026-05-23',
      partyLedgerName: 'Customer A',
      voucherNumber: 'S-1',
      items: [
        {
          itemName: 'Widget',
          quantity: 1,
          rate: 1000,
          taxType: 'IGST',
          taxPercent: 18,
          igstLedgerName: 'IGST Output'
        }
      ]
    });

    expect(voucher.partyName).toBe('Customer A');
    expect(voucher.inventoryAllocations).toHaveLength(1);
    expect(voucher.ledgerEntries.length).toBeGreaterThanOrEqual(2);
  });

  test('purchase voucher ledger lines balance with inventory accounting', () => {
    const voucher = mapItemVoucherPayload({
      voucherMode: 'purchase',
      vchType: 'Purchase',
      date: '2026-05-25',
      partyLedgerName: 'Vendor',
      amount: 5310,
      items: [{ itemName: 'Item', quantity: 1, rate: 4500, amount: 4500, taxPercent: 18, taxType: 'CGST/SGST', cgstLedgerName: 'CGST', sgstLedgerName: 'SGST' }],
      ledgerEntries: [
        { ledgerName: 'CGST', amount: 405 },
        { ledgerName: 'SGST', amount: 405 }
      ]
    });

    let sum = 0;
    for (const e of voucher.ledgerEntries) sum += e.amount;
    for (const inv of voucher.inventoryAllocations) {
      for (const a of inv.accountingAllocations) sum += a.amount;
    }
    expect(Math.abs(sum)).toBeLessThan(0.03);
  });

  test('maps ledger and stock item masters', () => {
    const ledger = mapLedgerPayload({
      name: 'Party X',
      parent: 'Sundry Debtors',
      addressLines: ['Line 1'],
      pincode: '110001'
    });
    expect(ledger.name).toBe('Party X');
    expect(ledger.group).toBe('Sundry Debtors');
    expect(ledger.mailingDetails[0].addressLines).toEqual(['Line 1']);

    const item = mapStockItemPayload({ name: 'SKU-1', baseUnits: 'Nos' });
    expect(item.name).toBe('SKU-1');
    expect(item.baseUnit).toBe('Nos');
  });

  test('mapStockItemPayload does not set alias (PartNo injected in XML separately)', () => {
    const item = mapStockItemPayload({ name: 'SKU-1', baseUnits: 'Nos', barcode: '123456789' });
    expect(item.name).toBe('SKU-1');
    expect(item.alias).toBeUndefined();
  });

  test('buildItemLedgerEntries respects explicit gross total', () => {
    const lines = buildItemLedgerEntries(
      [{ itemName: 'A', quantity: 1, rate: 100 }],
      { partyLedgerName: 'P', grossTotal: 118 },
      [{ ledgerName: 'IGST', amount: 18 }],
      'sales'
    );
    const party = lines.find((l) => l.isPartyLedger);
    expect(Math.abs(party.amount)).toBe(118);
  });
});
