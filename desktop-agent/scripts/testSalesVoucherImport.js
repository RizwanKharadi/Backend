/**
 * Preview Sales voucher mapped for tally-sync-ts (no Tally call unless --send).
 * node scripts/testSalesVoucherImport.js
 * node scripts/testSalesVoucherImport.js --send
 */
const fs = require('fs');
const path = require('path');
const { mapItemVoucherPayload } = require('../src/utils/tallySyncTsImportMapper');
const TallyService = require('../src/services/TallyService');

const sample = {
  companyName: process.env.TALLY_COMPANY || 'Demo App',
  voucherTypeName: process.env.TALLY_VCH_TYPE || 'Sales GST (26-27)',
  date: '2026-05-23',
  partyLedgerName: 'Ashtalakshmi Textiles',
  voucherNumber: 'AIM-TEST-001',
  reference: 'AIM/SO/TEST',
  narration: 'Test import from FinSync360',
  salesLedgerName: 'Sales GST',
  items: [
    {
      itemName: 'Tally Cloud ( Saas Model )',
      quantity: 2,
      unit: 'No.',
      rate: 6000,
      hsnCode: '998315',
      godownName: 'AIM INFOCOM',
      taxType: 'CGST/SGST',
      taxPercent: 18,
      cgstLedgerName: 'CGST Central Tax',
      sgstLedgerName: 'SGST-State Tax'
    }
  ]
};

async function main() {
  const voucher = mapItemVoucherPayload(sample);
  const outPath = path.join(__dirname, 'sales-import-preview.json');
  fs.writeFileSync(outPath, JSON.stringify(voucher, null, 2), 'utf8');
  console.log('Wrote', outPath);

  if (process.argv.includes('--send')) {
    const tally = new TallyService();
    await tally.loadConfig?.().catch(() => {});
    const result = await tally.importSalesVoucher(sample);
    console.log('Import result:', result);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
