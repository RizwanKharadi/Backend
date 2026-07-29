# Backend scripts (MySQL)

## Create admin (required for first login)

Set your own credentials in `backend/.env` (never commit real passwords):

```env
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=your-strong-password
ADMIN_NAME=Admin
ADMIN_PHONE=+91XXXXXXXXXX
```

Then:

```bash
npm run create:single-admin
```

The script refuses placeholder emails like `admin@finsync360.com`.

## Demo user (optional)

```env
DEMO_EMAIL=you+demo@yourdomain.com
DEMO_PASSWORD=your-demo-password
```

```bash
npm run demo:user
```

## Clear Tally-synced data

```bash
npm run clear:tally-data
```

## MySQL verification

```bash
npm run verify:mysql
node scripts/verify-bulk-voucher-sync.js
node scripts/verifyTallyIntegration.js
```

## Local MySQL

See `scripts/start-local-mysql.bat` and `scripts/setup-mysql-local.sql`.
Docker alternative: `docker compose -f docker-compose.mysql.yml up -d`
