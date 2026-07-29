/**
 * Disable licensing enforcement flags in DB for demos (MySQL).
 */
import dotenv from 'dotenv';
dotenv.config();
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

async function main() {
  if (!process.env.MYSQL_HOST && !process.env.DATABASE_URL) {
    console.error('MySQL env not configured');
    process.exit(1);
  }
  await connectDB();
  const { Organization, Subscription } = getModels();
  const orgs = await Organization.find({}).lean();
  console.log(`Organizations: ${orgs.length}`);
  for (const org of orgs) {
    await Organization.findByIdAndUpdate(org.id, {
      $set: { status: 'active', mobileEnabled: true },
    });
  }
  const subs = await Subscription.find({}).lean();
  for (const sub of subs) {
    await Subscription.findByIdAndUpdate(sub.id, {
      $set: { status: 'active', planId: 'pro' },
    });
  }
  console.log('Licensing relaxed for demo orgs/subs. Also set LICENSE_ENFORCEMENT=false in .env');
  await disconnectDB();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
