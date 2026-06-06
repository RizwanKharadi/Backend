/**
 * Demo helper: raise seat limits in MongoDB Atlas so multiple desktop-agents can activate.
 * Full licensing bypass still requires LICENSE_ENFORCEMENT=false on Railway (see scripts/railway-demo-licensing.ps1).
 *
 * Usage (from backend/):
 *   node scripts/demo-disable-licensing.js
 *   node scripts/demo-disable-licensing.js --seats 10
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEMO_SEATS = parseInt(process.argv.find((a) => a.startsWith('--seats='))?.split('=')[1] || '99', 10);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const subs = db.collection('subscriptions');
  const devices = db.collection('devicelicenses');

  const subResult = await subs.updateMany({}, { $set: { seatLimit: DEMO_SEATS } });
  const activeDevices = await devices.find({ status: 'active' }).toArray();

  console.log(`Updated ${subResult.modifiedCount} subscription(s) to seatLimit=${DEMO_SEATS}`);
  console.log(`Active devices: ${activeDevices.length}`);
  for (const d of activeDevices) {
    console.log(`  - ${d.agentId} (${d.hostname || 'no hostname'}) org=${d.organization}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
