/**
 * Empty every table without touching the schema.
 *
 * TRUNCATE, not DROP: the tables, columns, indexes and auto-increment counters
 * stay exactly as they are, so the app starts against the same structure it was
 * already running on. Sequelize is never asked to rebuild anything.
 *
 * Dry run by default. Pass --apply to actually delete, and take a dump first —
 * this is not recoverable.
 *
 *   node scripts/resetAllData.js            # show what would be deleted
 *   node scripts/resetAllData.js --apply    # do it
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');

// Nothing here is worth keeping on a reset, but listing them explicitly means a
// future table cannot be skipped by accident.
const connect = () =>
  mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: false,
  });

const main = async () => {
  const db = process.env.MYSQL_DATABASE;
  if (!db) {
    console.error('MYSQL_DATABASE is not set — refusing to run.');
    process.exit(1);
  }

  const conn = await connect();

  const [tables] = await conn.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [db]
  );

  if (!tables.length) {
    console.log(`No tables found in ${db}. Nothing to do.`);
    await conn.end();
    return;
  }

  console.log(`Database: ${db}`);
  console.log(`${APPLY ? 'DELETING' : 'Would delete'} rows from ${tables.length} tables:\n`);

  let total = 0;
  const counts = [];
  for (const { name } of tables) {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
    counts.push({ table: name, rows: n });
    total += n;
  }
  console.table(counts.filter((c) => c.rows > 0));
  console.log(`Total rows: ${total}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to delete. Take a mysqldump first.');
    await conn.end();
    return;
  }

  // Foreign keys have to come off: TRUNCATE is refused on any table another
  // table references, regardless of whether rows actually point at it.
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const { name } of tables) {
      await conn.query(`TRUNCATE TABLE \`${name}\``);
      process.stdout.write(`  truncated ${name}\n`);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  let remaining = 0;
  for (const { name } of tables) {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
    remaining += n;
  }

  const [after] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
    [db]
  );

  console.log(`\nDone. Rows remaining: ${remaining}. Tables still present: ${after[0].n}.`);
  console.log('Next: node scripts/create-single-admin.js to recreate the admin login.');

  await conn.end();
};

main().catch((error) => {
  console.error('Reset failed:', error.message);
  process.exit(1);
});
