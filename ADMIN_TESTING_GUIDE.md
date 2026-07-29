# Admin & Testing Users Guide

Create admin/test accounts with **your own** email and password. Do not use placeholder accounts.

## Create admin (MySQL)

In `backend/.env`:

```env
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=your-strong-password
ADMIN_NAME=Admin
ADMIN_PHONE=+91XXXXXXXXXX
```

```bash
cd backend
npm run create:single-admin
```

The seed script refuses `*@finsync360.com` placeholders.

## Optional demo user

```env
DEMO_EMAIL=you+demo@yourdomain.com
DEMO_PASSWORD=your-demo-password
```

```bash
npm run demo:user
```

## Local stack smoke test

1. Start MySQL (`backend/scripts/start-local-mysql.bat` or Docker).
2. `cd backend && npm run dev`
3. `GET http://127.0.0.1:5000/health`
4. Login with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`
5. Point desktop-agent at `http://127.0.0.1:5000/api` and `ws://127.0.0.1:5000/tally-agent`
6. Sync from TallyPrime; confirm rows in MySQL (`parties`, `vouchers`, `items`)
7. Point mobile `API_BASE_URL` at the same API

See [docs/MYSQL_LOCAL_SYNC_VERIFICATION.md](docs/MYSQL_LOCAL_SYNC_VERIFICATION.md).

## Automated MySQL checks

```bash
cd backend
npm run verify:mysql
node scripts/verify-bulk-voucher-sync.js
node scripts/verifyTallyIntegration.js
```

## Security

- Never commit real passwords in `.env` or docs.
- Use `LICENSE_ENFORCEMENT=false` only for local demos.
- On Hostinger VPS, seed once with your `ADMIN_*` values, then keep secrets in server env only.
