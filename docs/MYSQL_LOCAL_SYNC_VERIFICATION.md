# Local MySQL sync verification (Phase 1)

Use this instead of Atlas. **Do not use placeholder emails** — set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env` to your own account, then run `npm run create:single-admin`.

## Prerequisites

1. MySQL running (`scripts/start-local-mysql.bat` or Docker Compose).
2. `backend/.env` has `MYSQL_*` and your `ADMIN_*` values.
3. Backend: `cd backend && npm run dev`
4. TallyPrime open on port 9000.
5. Desktop-agent pointed at local API:
   - HTTP: `http://127.0.0.1:5000/api`
   - WS: `ws://127.0.0.1:5000/tally-agent`
6. Mobile (optional): `API_BASE_URL=http://<your-lan-ip>:5000/api`

## Checklist

1. `GET http://127.0.0.1:5000/health` → OK
2. Login with **your** `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Activate device / link company from desktop-agent
4. Run sync (masters + vouchers)
5. Confirm rows in MySQL:
   ```sql
   SELECT COUNT(*) FROM parties;
   SELECT COUNT(*) FROM vouchers;
   SELECT COUNT(*) FROM items;
   ```
6. Mobile lists companies / vouchers / parties from the same API
7. `npm run verify:mysql` passes

## Automated checks (no Tally required)

```bash
cd backend
npm run check:local-stack
npm run verify:mysql
node scripts/verify-bulk-voucher-sync.js
node scripts/verifyTallyIntegration.js
```

When this checklist is green, buy Hostinger VPS and follow [HOSTINGER_VPS_MYSQL_DEPLOY.md](./HOSTINGER_VPS_MYSQL_DEPLOY.md).
