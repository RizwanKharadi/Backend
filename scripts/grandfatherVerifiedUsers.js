/**
 * One-off backfill: mark every pre-existing account as email-verified.
 *
 * Login now refuses unverified accounts. Without this, everyone who signed up
 * before OTP shipped — including the admin — is locked out on next login, and
 * can only recover through an email flow that may not be deliverable yet.
 *
 * Safe to run more than once. Run it BEFORE deploying the login gate.
 *
 *   node scripts/grandfatherVerifiedUsers.js          # report only
 *   node scripts/grandfatherVerifiedUsers.js --apply  # write
 */
import dotenv from 'dotenv';
import { connectDB, getSequelize } from '../src/config/database.js';

dotenv.config();

const apply = process.argv.includes('--apply');

async function main() {
  await connectDB();
  const sequelize = getSequelize();

  const [rows] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM users WHERE isEmailVerified = 0 OR isEmailVerified IS NULL'
  );
  const pending = Number(rows?.[0]?.n ?? 0);

  console.log(`Unverified accounts: ${pending}`);

  if (pending === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (!apply) {
    console.log('Dry run — re-run with --apply to mark these verified.');
    return;
  }

  const [result] = await sequelize.query(
    'UPDATE users SET isEmailVerified = 1 WHERE isEmailVerified = 0 OR isEmailVerified IS NULL'
  );
  console.log(`Marked ${pending} existing account(s) as verified.`, result ?? '');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
