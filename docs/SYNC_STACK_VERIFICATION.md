# Tally Sync Stack Verification (No Web Required)

Use this checklist to confirm **TallyPrime → desktop-agent → backend → MongoDB Atlas → mobile** works. You do **not** need `frontend/` or `frontend-nextjs/` for this flow.

## Architecture

```
TallyPrime (port 9000)
    → desktop-agent (XML + WebSocket)
    → backend (/tally-agent + REST)
    → MongoDB Atlas
    → mobile app (REST + JWT only)
```

## 1. Prerequisites

| Item | Check |
|------|--------|
| Node.js 18+ | `node -v` |
| MongoDB Atlas URI in `backend/.env` | `MONGODB_URI=mongodb+srv://...` |
| TallyPrime running | Company loaded, ODBC/XML on port **9000** |
| Backend port | `PORT=5000` in `backend/.env` (default) |

## 2. Start backend

```bash
cd backend
npm install
npm run dev
```

Verify:

```bash
curl http://localhost:5000/health
```

Expected: JSON with `"status":"ok"` (or similar healthy response).

Or from repo root:

```bash
npm run verify:sync-stack
```

## 3. Configure desktop-agent

1. Start agent: `npm run desktop-agent:dev` (from repo root).
2. In agent UI:
   - **Server API URL:** `http://localhost:5000/api` (or your deployed backend `/api`)
   - **WebSocket:** `ws://127.0.0.1:5000/tally-agent` (default in [WebSocketClient.js](../desktop-agent/src/services/WebSocketClient.js))
3. Log in with a FinSync360 user (JWT).
4. **Tally:** test connection; enable ODBC/XML in TallyPrime.
5. **Link company:** use “Link Tally” / `POST /api/companies/link-tally`.
6. **Activate device** (if `LICENSE_ENFORCEMENT=true`): agent calls `POST /api/devices/activate`.
7. Run sync; confirm progress completes without errors.

For local dev without licensing gates:

```env
LICENSE_ENFORCEMENT=false
```

in `backend/.env`.

## 4. Confirm data in MongoDB Atlas

After sync, in Atlas (or Compass) for database `finsync360`, confirm collections for the linked company, e.g.:

- `companies`
- `parties` / `ledgers` (as used by your sync)
- `vouchers`
- `items` / inventory collections

Match `companyId` to the linked company from the agent.

## 5. Mobile app

1. Ensure `mobile/.env.development` (or `mobile/.env`):

   ```env
   API_BASE_URL=http://localhost:5000/api
   ```

2. Physical device: `adb reverse tcp:5000 tcp:5000` so phone `localhost:5000` reaches your PC.

3. Start Metro: `npm run mobile:dev`.

4. Log in with the **same user** as the agent (same org/company).

5. Open dashboard / vouchers / parties — data should match what was synced.

## 6. Optional: web admin (not required for sync)

Use **frontend-nextjs** only if you need a browser UI or superadmin/billing:

```bash
npm run frontend:dev
# http://localhost:3000
```

Legacy CRA app in `frontend/` is deprecated; see [frontend/README.md](../frontend/README.md).

## Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Agent cannot connect to Tally | TallyPrime open; port 9000; ODBC/XML enabled |
| WebSocket fails | Backend running; URL `ws://127.0.0.1:5000/tally-agent`; firewall |
| Sync rejected (license) | `POST /api/devices/activate` or set `LICENSE_ENFORCEMENT=false` locally |
| Mobile empty data | Same login/company as agent; `API_BASE_URL` correct; `adb reverse` on device |
| CORS errors (web only) | Set `FRONTEND_URL` in backend; not needed for mobile/agent |

## Quick command reference

```bash
npm run backend:dev          # API + WebSocket
npm run desktop-agent:dev    # Tally sync agent
npm run mobile:dev             # React Native
npm run sync:dev               # backend + agent together
npm run verify:sync-stack      # config + health checks
```
