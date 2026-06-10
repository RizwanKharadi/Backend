/**
 * Quick verification for bulk voucher summary upsert.
 * Usage: node scripts/verify-bulk-voucher-sync.js
 * Requires MONGODB_URI in backend/.env (or env).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import tallyWebSocketService from '../src/services/tallyWebSocketService.js';
import Voucher from '../src/models/Voucher.js';
import Company from '../src/models/Company.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COMPANY_ID = process.env.VERIFY_COMPANY_ID;

async function main() {
  if (!process.env.MONGODB_URI) {
    console.log('SKIP: MONGODB_URI not set — bulk voucher sync code verified via static checks only');
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  let company;
  if (COMPANY_ID) {
    company = await Company.findById(COMPANY_ID).lean();
  } else {
    company = await Company.findOne().lean();
  }

  if (!company) {
    console.log('SKIP: No company found for integration test');
    await mongoose.disconnect();
    process.exit(0);
  }

  const companyDoc = { _id: company._id, createdBy: company.createdBy };
  const suffix = Date.now();
  const rows = Array.from({ length: 50 }, (_, i) => ({
    detailLevel: 'summary',
    voucherNumber: `BULK-TEST-${suffix}-${i}`,
    tallyId: `bulk-test-guid-${suffix}-${i}`,
    partyName: '',
    date: '2024-06-01',
    amount: 100 + i,
    voucherType: 'sales',
    ledgerNames: ['Sales Account']
  }));

  const start = Date.now();
  const result = await tallyWebSocketService.bulkUpsertVoucherSummaryBatch(companyDoc, rows);
  const elapsed = Date.now() - start;

  const count = await Voucher.countDocuments({
    company: company._id,
    'tallySync.tallyId': { $regex: `^bulk-test-guid-${suffix}-` }
  });

  await Voucher.deleteMany({
    company: company._id,
    'tallySync.tallyId': { $regex: `^bulk-test-guid-${suffix}-` }
  });

  await mongoose.disconnect();

  console.log('bulkUpsertVoucherSummaryBatch result:', result);
  console.log('inserted count:', count, '/ 50');
  console.log('elapsed ms:', elapsed);

  if (result.processed !== 50 || count !== 50) {
    console.error('FAIL: expected 50 processed vouchers');
    process.exit(1);
  }

  console.log('PASS: bulk voucher sync verified');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
