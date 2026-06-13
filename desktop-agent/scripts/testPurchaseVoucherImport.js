/**
 * Preview Purchase voucher mapped for tally-sync-ts and verify Dr/Cr balance.
 * node scripts/testPurchaseVoucherImport.js
 */
const fs = require('fs');
const path = require('path');
const { mapItemVoucherPayload } = require('../src/utils/tallySyncTsImportMapper');

const sample = {
  companyName: process.env.TALLY_COMPANY || 'Demo App',
  vchType: 'Purchase',
  voucherMode: 'purchase',
  voucherTypeName: 'Purchase',
  date: '2026-05-25',
  partyLedgerName: 'Keshav Computer Pvt.Ltd.',
  voucherNumber: 'PUR-TEST-001',
  reference: 'PUR-TEST-001',
  purchaseLedgerName: 'Purchase GST',
  amount: 5310,
  items: [
    {
      itemName: 'Tally Software Services-Gold',
      quantity: 1,
      unit: 'No.',
      rate: 4500,
      amount: 4500,
      godownName: 'AIM INFOCOM',
      taxType: 'CGST/SGST',
      taxPercent: 18,
      cgstLedgerName: 'Input CGST-Central Tax',
      sgstLedgerName: 'Input SGST-State Tax'
    }
  ],
  ledgerEntries: [
    { ledgerName: 'Input CGST-Central Tax', amount: 405, credit: 405 },
    { ledgerName: 'Input SGST-State Tax', amount: 405, credit: 405 }
  ]
};

function ledgerBalance(voucher) {
  let sum = 0;
  for (const entry of voucher.ledgerEntries || []) {
    sum += Number(entry.amount) || 0;
  }
  for (const inv of voucher.inventoryAllocations || []) {
    for (const alloc of inv.accountingAllocations || []) {
      sum += Number(alloc.amount) || 0;
    }
  }
  return sum;
}

const voucher = mapItemVoucherPayload(sample);
const outPath = path.join(__dirname, 'purchase-import-preview.json');
fs.writeFileSync(outPath, JSON.stringify(voucher, null, 2), 'utf8');
const balance = ledgerBalance(voucher);
console.log('Wrote', outPath);
console.log('Ledger + inventory accounting balance (expect ~0):', balance.toFixed(2));
if (Math.abs(balance) > 0.02) {
  console.error('FAIL: amounts do not balance');
  process.exit(1);
}
console.log('OK: balanced');
