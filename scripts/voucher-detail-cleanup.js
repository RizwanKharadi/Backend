/**
 * Voucher detail cleanup (MySQL).
 */
import dotenv from 'dotenv';
dotenv.config();
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

async function main() {
  await connectDB();
  const { VoucherDetail } = getModels();
  const days = Number(process.env.VOUCHER_DETAIL_TTL_DAYS) || 30;
  const result = await VoucherDetail.cleanupStale(days);
  console.log('Cleaned stale voucher details:', result);
  await disconnectDB();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
