/**
 * Seed an admin user into MySQL (fresh start).
 * Credentials MUST come from env — no hardcoded emails/passwords.
 *
 * Required:
 *   ADMIN_EMAIL
 *   ADMIN_PASSWORD
 * Optional:
 *   ADMIN_NAME (default: Admin)
 *   ADMIN_PHONE (default: +910000000000)
 *   ADMIN_ROLE  (default: superadmin)
 *
 * Usage:
 *   set ADMIN_EMAIL=you@example.com
 *   set ADMIN_PASSWORD=your-strong-password
 *   node scripts/create-single-admin.js
 */
import dotenv from 'dotenv';
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

dotenv.config();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Admin';
  const phone = process.env.ADMIN_PHONE?.trim() || '+910000000000';
  const role = process.env.ADMIN_ROLE?.trim() || 'superadmin';

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env (or the environment) before running this script.');
    process.exit(1);
  }

  if (email.toLowerCase().includes('finsync360.com') || email.toLowerCase() === 'admin@finsync360.com') {
    console.error('Refusing to seed placeholder/demo emails. Use your real ADMIN_EMAIL.');
    process.exit(1);
  }

  const result = await connectDB();
  if (!result.connected) {
    console.error('MySQL not connected. Check MYSQL_* env vars and that mysqld is running.');
    process.exit(1);
  }

  const { User } = getModels();

  // Remove any leftover placeholder admin if present
  await User.deleteMany({ email: 'admin@finsync360.com' });

  let existing = await User.findOne({ email }).select('+password');
  if (existing) {
    console.log('Admin already exists for', email);
    const valid = await existing.matchPassword(password);
    if (!valid) {
      existing.password = password;
      await existing.save();
      console.log('Password updated from ADMIN_PASSWORD');
    }
    await disconnectDB();
    return;
  }

  const adminUser = await User.create({
    name,
    email,
    phone,
    password,
    role,
    isActive: true,
    isEmailVerified: true,
    permissions: {
      vouchers: { create: true, read: true, update: true, delete: true },
      inventory: { create: true, read: true, update: true, delete: true },
      reports: { financial: true, inventory: true, gst: true, analytics: true },
      settings: { company: true, users: true, integrations: true },
    },
  });

  console.log('Admin created:', adminUser.email, adminUser.id);
  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
