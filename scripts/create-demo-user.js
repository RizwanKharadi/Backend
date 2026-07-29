/**
 * Create a demo user (MySQL).
 * Requires DEMO_EMAIL and DEMO_PASSWORD in env — no hardcoded accounts.
 */
import dotenv from 'dotenv';
dotenv.config();
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

async function main() {
  const email = process.env.DEMO_EMAIL?.trim();
  const password = process.env.DEMO_PASSWORD;
  const name = process.env.DEMO_NAME?.trim() || 'Demo User';
  const phone = process.env.DEMO_PHONE?.trim() || '+910000000001';

  if (!email || !password) {
    console.error('Set DEMO_EMAIL and DEMO_PASSWORD in backend/.env before running.');
    process.exit(1);
  }

  await connectDB();
  const { User } = getModels();
  const existing = await User.findOne({ email });
  if (existing) {
    console.log('Demo user exists:', email);
    await disconnectDB();
    return;
  }
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: 'admin',
    isActive: true,
    isEmailVerified: true,
  });
  console.log('Demo user created:', user.email, user.id);
  await disconnectDB();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
