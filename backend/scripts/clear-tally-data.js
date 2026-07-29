/**
 * Clear Tally-synced transactional/master data from MySQL (keeps users/orgs).
 * Usage: node scripts/clear-tally-data.js
 */
import dotenv from 'dotenv';
dotenv.config();
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

const MODELS = [
  'VoucherDetail',
  'Voucher',
  'Party',
  'Item',
  'Godown',
  'Unit',
  'VoucherType',
  'TallyAccount',
  'GstRegistration',
  'ProfitLossReport',
  'BalanceSheetReport',
  'OutstandingReceivable',
  'TallySync',
  'TallyConnection',
];

async function main() {
  const r = await connectDB();
  if (!r.connected) {
    console.error('MySQL not connected');
    process.exit(1);
  }
  const models = getModels();
  for (const name of MODELS) {
    const Model = models[name];
    if (!Model) continue;
    const result = await Model.deleteMany({});
    console.log(`Cleared ${name}:`, result.deletedCount ?? result);
  }
  await disconnectDB();
  console.log('Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
