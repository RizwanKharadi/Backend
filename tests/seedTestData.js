/**
 * Seed minimal test data into MySQL test database.
 * Uses TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD from env when set.
 */
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_ENV = 'test';
process.env.MYSQL_DATABASE = process.env.MYSQL_TEST_DATABASE || 'finsync360_test';

import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

async function main() {
  const email = process.env.TEST_ADMIN_EMAIL?.trim();
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('Skip seed: set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD to seed a test admin.');
    process.exit(0);
  }

  await connectDB();
  const { User } = getModels();
  await User.deleteMany({ email: 'admin@finsync360.com' });
  await User.deleteMany({ email: 'testadmin@finsync360.com' });

  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({
      name: process.env.TEST_ADMIN_NAME || 'Test Admin',
      email,
      phone: process.env.TEST_ADMIN_PHONE || '+910000000002',
      password,
      role: 'admin',
      isActive: true,
      isEmailVerified: true,
    });
    console.log('Created test admin', email);
  } else {
    console.log('Test admin exists', email);
  }
  await disconnectDB();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
