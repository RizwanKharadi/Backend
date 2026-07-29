/**
 * Local stack readiness check (MySQL backend + optional Tally port).
 * Does not print secrets.
 */
import dotenv from 'dotenv';
dotenv.config();

const results = [];

function ok(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  // MySQL via mysql2
  try {
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || 'finsync',
      password: process.env.MYSQL_PASSWORD || 'finsyncpass',
      database: process.env.MYSQL_DATABASE || 'finsync360',
    });
    const [rows] = await conn.query(
      `SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM companies) AS companies,
        (SELECT COUNT(*) FROM parties) AS parties,
        (SELECT COUNT(*) FROM vouchers) AS vouchers,
        (SELECT COUNT(*) FROM items) AS items`
    );
    await conn.end();
    ok('MySQL reachable', true, JSON.stringify(rows[0]));
  } catch (e) {
    ok('MySQL reachable', false, e.message);
  }

  // Backend health
  try {
    const h = await fetch('http://127.0.0.1:5000/health');
    const j = await h.json();
    ok('Backend /health', h.ok && j.status === 'OK', `uptime=${Math.round(j.uptime || 0)}s`);
  } catch (e) {
    ok('Backend /health', false, e.message);
  }

  // Login with ADMIN_*
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    ok('Admin login', false, 'ADMIN_EMAIL/ADMIN_PASSWORD not set in .env');
  } else {
    try {
      const res = await fetch('http://127.0.0.1:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      ok('Admin login', data.success === true && Boolean(data?.data?.token));
    } catch (e) {
      ok('Admin login', false, e.message);
    }
  }

  // TallyPrime XML port
  try {
    const net = await import('net');
    const open = await new Promise((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port: 9000 }, () => {
        s.end();
        resolve(true);
      });
      s.on('error', () => resolve(false));
      s.setTimeout(1500, () => {
        s.destroy();
        resolve(false);
      });
    });
    ok('TallyPrime :9000', open, open ? 'open — ready for agent sync' : 'closed — open TallyPrime with XML port 9000');
  } catch (e) {
    ok('TallyPrime :9000', false, e.message);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('');
  if (failed.length === 0) {
    console.log('Stack ready. Run desktop-agent in DEV and sync.');
    console.log('  cd desktop-agent && npm run electron:dev');
  } else if (failed.every((f) => f.name === 'TallyPrime :9000')) {
    console.log('Backend+MySQL OK. Open TallyPrime (port 9000), then:');
    console.log('  cd desktop-agent && npm run electron:dev');
  } else {
    console.log('Fix FAIL items above, then re-run: node scripts/check-local-sync-stack.js');
    process.exitCode = 1;
  }
}

main();
