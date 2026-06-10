/**
 * LRU / TTL cleanup for voucher_details cache.
 * Usage: node scripts/voucher-detail-cleanup.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import VoucherDetail from '../src/models/VoucherDetail.js';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const result = await VoucherDetail.cleanupStale();
  console.log('Voucher detail cleanup:', result);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
