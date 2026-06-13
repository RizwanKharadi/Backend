const {
  mapStockItemRow,
  mapLedgerToPartySyncRow,
  mapGstRegistrationRow,
  mapVoucherFromLibrary,
  mapLicenseInfoForServer,
  isSundryPartyLedger
} = require('../tallySyncTsExportMapper');

describe('tallySyncTsExportMapper', () => {
  test('isSundryPartyLedger detects sundry groups', () => {
    expect(isSundryPartyLedger('Sundry Debtors')).toBe(true);
    expect(isSundryPartyLedger('Sales Accounts')).toBe(false);
  });

  test('maps stock item row', () => {
    const row = mapStockItemRow({
      name: 'Widget',
      baseUnit: 'Nos',
      guid: 'g1',
      openingBalance: 10
    });
    expect(row.name).toBe('Widget');
    expect(row.baseUnits).toBe('Nos');
  });

  test('maps sundry ledger to party row', () => {
    const row = mapLedgerToPartySyncRow({
      name: 'Customer A',
      group: 'Sundry Debtors',
      guid: 'lg1',
      gstRegistrationDetails: [{ gstin: '29AAAAA0000A1Z5', state: 'Karnataka' }]
    });
    expect(row.recordType).toBe('party');
    expect(row.gstin).toBe('29AAAAA0000A1Z5');
  });

  test('maps non-sundry ledger to chart row', () => {
    const row = mapLedgerToPartySyncRow({
      name: 'Sales',
      group: 'Sales Accounts',
      guid: 'lg2'
    });
    expect(row.recordType).toBe('ledger');
  });

  test('maps GST registration row', () => {
    const row = mapGstRegistrationRow({
      name: 'Karnataka Registration',
      stateName: 'Karnataka',
      gstin: '29aaaaa0000a1z5'
    });
    expect(row.gstin).toBe('29AAAAA0000A1Z5');
  });

  test('maps library voucher with inventory', () => {
    const v = mapVoucherFromLibrary({
      voucherType: 'Sales',
      date: '2026-05-23',
      voucherNumber: 'S-1',
      partyName: 'Party',
      inventoryAllocations: [
        {
          stockItemName: 'Item',
          quantity: ' 2.000 Nos',
          rate: '100.00/Nos',
          amount: 200,
          isDeemedPositive: false,
          accountingAllocations: [{ ledgerName: 'Sales', amount: -200 }]
        }
      ],
      ledgerEntries: [
        {
          ledgerName: 'Party',
          amount: -236,
          isDeemedPositive: true,
          isPartyLedger: true
        }
      ]
    });
    expect(v.voucherNumber).toBe('S-1');
    expect(v.items).toHaveLength(1);
    expect(v.ledgerEntries.length).toBeGreaterThan(0);
  });

  test('maps license info for server payload', () => {
    const mapped = mapLicenseInfoForServer({
      serialNumber: '123',
      planName: 'Gold',
      isGold: true,
      tallyVersion: '5.0'
    });
    expect(mapped.serialNumber).toBe('123');
    expect(mapped.planName).toBe('Gold');
  });
});
