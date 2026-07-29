# Heroku scalability for FinSync360 (Tally sync flow)

This document reviews the deployment scripts and whether **Heroku** can carry your production architecture:

**TallyPrime (customer PC) → desktop-agent → backend (WebSocket + REST) → MongoDB Atlas → mobile app**

## What the shell scripts do

| Script | Purpose |
|--------|---------|
| [`heroku-deploy.sh`](../heroku-deploy.sh) | Interactive deploy: creates 3 Heroku apps (backend, frontend, ML), sets JWT/Redis env, pushes via git remotes |
| [`deploy-services.sh`](../deploy-services.sh) | Quick redeploy of `finsync-backend`, `finsync-frontend`, `finsync-ml` with fixed app names |
| [`quick-setup.sh`](../quick-setup.sh) | Local dev dependency install |
| [`setup.sh`](../setup.sh) | Local dev environment checks |

**Important:** `deploy-services.sh` previously embedded a MongoDB Atlas URI in plain text. **Never commit database passwords.** Set `MONGODB_URI` via `heroku config:set` or CI secrets only.

Recommended backend deploy (monorepo):

```bash
git push heroku-backend `git subtree split --prefix=backend HEAD`:refs/heads/main --force
```

(Use `main` if your Heroku app uses `main` as default branch.)

## Is Heroku suitable for this flow?

### What works well on Heroku today

| Component | Heroku fit |
|-----------|------------|
| **REST API** (`/api/*`) | Good on standard web dynos |
| **MongoDB Atlas** | Excellent — external DB is the right pattern |
| **Mobile app** | Good — stateless HTTP to backend |
| **Razorpay webhooks** | Good — `POST /api/billing/webhook` on web dyno |
| **Low–medium customer count** | Good on 1–2 Performance-M web dynos |

### Critical constraint: Tally WebSocket (`/tally-agent`)

The desktop-agent uses a **persistent WebSocket** for bulk sync. The backend keeps agent connections in an **in-memory `Map`** ([`tallyWebSocketService.js`](../backend/src/services/tallyWebSocketService.js)).

| Issue | Impact |
|-------|--------|
| **Single dyno** | Works — all agents connect to one process |
| **Multiple web dynos** | **Broken** — agents on different dynos; sync messages miss the right connection |
| **Dyno restart** | Agents disconnect; must reconnect (agent already reconnects) |
| **30s HTTP timeout** | Does not apply to WebSockets, but long **HTTP** requests can still timeout |

**Verdict:** Heroku is **acceptable for early commercial launch** if you run **one web dyno** (or use sticky sessions + shared Redis pub/sub — not implemented yet).

### Socket.IO (mobile realtime)

Same limitation if you scale horizontally without a Redis adapter for Socket.IO.

### Sync load

| Factor | Notes |
|--------|------|
| Voucher batch size | Up to ~2 MB per batch from agent |
| Concurrent customers | 50–100 agents on one M dyno is usually fine; profile with `heroku logs --tail` |
| Atlas | Scales independently; watch connection pool (`MONGODB_URI` pool options in `database.js`) |

## Recommended Heroku topology (commercial launch)

```
┌─────────────────────────────────────────────────────────┐
│ Heroku: finsync-backend (1× web dyno Performance-M)     │
│  - REST /api/*                                          │
│  - WebSocket /tally-agent  (all desktop agents)         │
│  - Socket.IO (mobile)                                   │
│  - POST /api/billing/webhook                            │
└───────────────────────────┬─────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     MongoDB Atlas                  Razorpay
```

Optional separate dynos:

- **ML service** — already on `finsync-ml` (fine separate)
- **Frontend Next.js** — static/SSR on separate app (fine)

Do **not** scale backend web dynos beyond 1 until you add:

1. **Redis** + Socket.IO adapter, and  
2. **Redis pub/sub** (or message queue) for routing `sync-data` to the dyno holding each `agentId` connection.

## Heroku config for licensing + billing (Phase 1–3)

Set on `finsync-backend`:

```bash
heroku config:set LICENSE_ENFORCEMENT=true -a finsync-backend
heroku config:set RAZORPAY_KEY_ID=... -a finsync-backend
heroku config:set RAZORPAY_KEY_SECRET=... -a finsync-backend
heroku config:set RAZORPAY_WEBHOOK_SECRET=... -a finsync-backend
heroku config:set BILLING_MONTHLY_PRICE_PAISE=99900 -a finsync-backend
heroku config:set BILLING_YEARLY_PRICE_PAISE=999900 -a finsync-backend
heroku config:set BILLING_CALLBACK_URL=https://your-frontend.com/settings/billing -a finsync-backend
```

Register webhook: `https://finsync-backend-d34180691b06.herokuapp.com/api/billing/webhook`

## When to move off Heroku (or scale differently)

Consider **AWS ECS / Railway / Render / VPS** with a load balancer when you need:

- **>100 concurrent desktop agents** with HA
- **Multiple backend instances** without dropping WebSocket sync
- **Dedicated worker** for heavy Tally XML processing (optional split from API)

Atlas stays; only the Node process hosting WebSockets needs a scaling story.

## Summary

| Question | Answer |
|----------|--------|
| Can we launch commercially on Heroku? | **Yes**, with **one backend web dyno** and Atlas |
| Is Heroku “infinitely scalable” for Tally sync? | **No** — horizontal web scaling needs Redis routing |
| Are deploy scripts enough? | They bootstrap apps; add billing env vars and **remove secrets from git** |
