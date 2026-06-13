/**
 * Probe Tally for voucher export formats (run: node scripts/testVoucherExport.js)
 */
const TallyService = require('../src/services/TallyService');

const company = 'Demo App';
const fromDate = '2026-04-01';
const toDate = '2026-05-18';

async function main() {
  const tally = new TallyService();
  await tally.initialize?.().catch(() => {});

  console.log('Testing voucher export for', company, fromDate, '→', toDate);

  try {
    const { vouchers } = await tally.getVouchers(company, fromDate, toDate);
    console.log('getVouchers count:', vouchers.length);
    if (vouchers[0]) {
      console.log('First voucher:', JSON.stringify(vouchers[0], null, 2).slice(0, 800));
    }
  } catch (e) {
    console.error('getVouchers failed:', e.message);
  }
}

main();
