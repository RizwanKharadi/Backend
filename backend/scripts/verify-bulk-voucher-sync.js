/**
 * Verify bulk voucher sync against MySQL (replaces Mongo script).
 */
import dotenv from 'dotenv';
dotenv.config();
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

async function main() {
  await connectDB();
  const { Company, Voucher } = getModels();
  const company = await Company.create({
    name: 'Bulk Sync Co',
    createdBy: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    tallyCompanyPath: 'BULK-GUID',
  });

  const ops = [];
  for (let i = 0; i < 5; i++) {
    ops.push({
      updateOne: {
        filter: { company: company.id, tallyId: `BULK-${i}` },
        update: {
          $set: {
            voucherNumber: String(i + 1),
            voucherType: 'sales',
            date: new Date(),
            partyName: `Party ${i}`,
            tallySync: { tallyId: `BULK-${i}`, synced: true },
            totals: { grandTotal: (i + 1) * 10 },
          },
        },
        upsert: true,
      },
    });
  }
  const result = await Voucher.bulkWrite(ops);
  const count = await Voucher.countDocuments({ company: company.id });
  console.log('bulkWrite result', result);
  console.log('voucher count', count);
  if (count !== 5) throw new Error(`Expected 5 vouchers, got ${count}`);

  await Voucher.deleteMany({ company: company.id });
  await Company.deleteMany({ id: company.id });
  await disconnectDB();
  console.log('BULK VOUCHER SYNC OK');
}

main().catch(async (e) => {
  console.error(e);
  try { await disconnectDB(); } catch (_) {}
  process.exit(1);
});
