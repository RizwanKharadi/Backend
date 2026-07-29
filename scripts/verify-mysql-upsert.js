import dotenv from 'dotenv';
dotenv.config();
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

await connectDB();
const { Company, Voucher, Party } = getModels();

const company = await Company.create({
  name: 'Demo Co',
  displayName: 'Demo',
  createdBy: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  tallyCompanyPath: 'GUID-1',
  tallyIntegration: { companyPath: 'GUID-1', enabled: true },
});

await Voucher.bulkWrite([
  {
    updateOne: {
      filter: { company: company.id, tallyId: 'VCH-001' },
      update: {
        $set: {
          voucherNumber: '1',
          voucherType: 'sales',
          date: new Date(),
          partyName: 'Acme',
          tallySync: { tallyId: 'VCH-001', synced: true },
          totals: { grandTotal: 100 },
        },
      },
      upsert: true,
    },
  },
]);

await Voucher.bulkWrite([
  {
    updateOne: {
      filter: { company: company.id, tallyId: 'VCH-001' },
      update: { $set: { partyName: 'Acme Updated', totals: { grandTotal: 200 } } },
      upsert: true,
    },
  },
]);

const rows = await Voucher.find({ company: company.id }).lean();
console.log('vouchers', rows.length, rows[0]?.partyName, rows[0]?.totals, rows[0]?.tallyId);

await Party.findOneAndUpdate(
  { company: company.id, name: 'Acme' },
  {
    $set: {
      type: 'customer',
      recordType: 'party',
      tallySync: { tallyId: 'P1', synced: true },
    },
  },
  { upsert: true, new: true }
);

const parties = await Party.find({ company: company.id }).lean();
console.log('parties', parties.length, parties[0]?.name, parties[0]?.tallyId);

await Voucher.deleteMany({ company: company.id });
await Party.deleteMany({ company: company.id });
await Company.deleteMany({ id: company.id });
await disconnectDB();
console.log('SYNC UPSERT OK');
