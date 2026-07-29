---
name: Production Launch Guide
overview: "Launch FinSync360 on Heroku + MongoDB Atlas with domain aiminfocom.com: api.aiminfocom.com for backend/WebSocket, desktop-agent on Tally PCs, mobile app, Razorpay billing. Project is dev-ready; production needs your own Heroku apps, Atlas cluster, and URL updates."
todos:
  - id: atlas-own-cluster
    content: Create your MongoDB Atlas M0 cluster (Mumbai), user, URI with /finsync360 DB
    status: pending
  - id: heroku-account-apps
    content: Heroku account + CLI; create aiminfo-finsync-api app (and optional ML/web apps)
    status: pending
  - id: heroku-deploy-backend
    content: Set config vars, git subtree push backend, scale web=1, verify /health
    status: pending
  - id: domain-aiminfocom
    content: DNS api.aiminfocom.com + www.aiminfocom.com to Heroku; heroku domains:add + ACM SSL
    status: pending
  - id: razorpay-billing
    content: Razorpay webhook https://api.aiminfocom.com/api/billing/webhook; LICENSE_ENFORCEMENT=true
    status: pending
  - id: repo-url-fixes
    content: Update mobile/.env.production, apiClient, agent defaults to api.aiminfocom.com
    status: pending
  - id: build-agent-installer
    content: electron:dist with baked api.aiminfocom.com URLs; host on www.aiminfocom.com
    status: pending
  - id: android-release
    content: Release keystore + Play Store with API_BASE_URL=https://api.aiminfocom.com/api
    status: pending
  - id: e2e-pilot
    content: SYNC_STACK_VERIFICATION + trial→subscribe on one customer Tally PC
    status: pending
isProject: false
---

# Production launch: Heroku + aiminfocom.com

## Is the project ready?

**Yes for commercial launch of the core product** (Tally → agent → cloud → mobile), assuming local dev sync already works.

| Area | Status | Notes |
|------|--------|--------|
| Tally → desktop-agent → backend → Atlas | Implemented | [docs/SYNC_STACK_VERIFICATION.md](docs/SYNC_STACK_VERIFICATION.md) |
| Mobile reads via REST + JWT | Implemented | [mobile/](mobile/) |
| Licensing (trial, seats, device activate) | Implemented | [docs/LICENSING.md](docs/LICENSING.md) |
| Razorpay subscriptions | Implemented | Pay from mobile or agent |
| Heroku deploy path | Repo-ready | [backend/Procfile](backend/Procfile), subtree deploy in [production_deployment_guide_cfc93ec5.plan.md](production_deployment_guide_cfc93ec5.plan.md) |
| Before first customer | **You must** create **your** Heroku apps + Atlas cluster; replace old team URLs in env files |

**Not required to sell:** ML service, web frontend, iOS (no `mobile/ios/` in repo).

---

## Does Heroku suit your requirement?

**Yes — recommended for you**, because:

- Repo is already set up for Heroku (`Procfile`, subtree deploy, existing docs)
- Provides **HTTPS + WSS** automatically (required for agent + mobile)
- Fine for **early and mid-scale** paying customers in India

**One critical rule:** Run **exactly 1 web dyno** on the backend app until Redis-based WebSocket scaling is built ([docs/HEROKU_SCALING.md](docs/HEROKU_SCALING.md)). Multiple dynos break Tally agent sync (connections are in-memory).

```mermaid
flowchart TB
  subgraph customerPC [Customer Windows PC]
    TP[TallyPrime :9000]
    Agent[desktop-agent]
    TP --> Agent
  end

  subgraph heroku [Heroku - 1 web dyno]
    API[Node backend]
    WS["/tally-agent WebSocket"]
    API --> WS
  end

  subgraph atlas [MongoDB Atlas]
    DB[(finsync360)]
  end

  subgraph phone [Phone]
    Mobile[Mobile app]
  end

  Agent -->|wss api.aiminfocom.com| WS
  Agent -->|https api.aiminfocom.com/api| API
  Mobile -->|https api.aiminfocom.com/api| API
  API --> DB
```

**Rough monthly cost (launch):**

| Item | Cost |
|------|------|
| Heroku backend (Eco/Basic web dyno) | ~$5–7/month |
| MongoDB Atlas M0 | Free |
| aiminfocom.com | Already owned |
| Optional: ML + Next.js web on Heroku | +$5–7 each if deployed |
| **Minimum launch** | **~$5–10/month** (backend + Atlas only) |

---

## Domain layout for aiminfocom.com

Use **one domain** — no separate domain for the mobile app.

| Hostname | Points to | Used by |
|----------|-----------|---------|
| **api.aiminfocom.com** | Heroku **backend** app | REST `https://api.aiminfocom.com/api`, WebSocket `wss://api.aiminfocom.com/tally-agent`, Razorpay webhook |
| **www.aiminfocom.com** | Marketing site (Heroku frontend, Netlify, or your host) | Landing, download agent, pricing, Play Store link |
| **aiminfocom.com** (apex) | Redirect to `www` (recommended) | Browser visitors |

Optional later:

| Hostname | Purpose |
|----------|---------|
| **admin.aiminfocom.com** | [frontend-nextjs](frontend-nextjs/) superadmin (you only) |

**Customer-facing URLs to bake into agent + mobile:**

```
API_BASE_URL=https://api.aiminfocom.com/api
WEBSOCKET_URL=wss://api.aiminfocom.com
TALLY_AGENT_URL=wss://api.aiminfocom.com/tally-agent
```

---

## Phase 0 — Prerequisites (Day 1)

### 1. Heroku account + CLI (Windows)

1. Sign up: [https://www.heroku.com](https://www.heroku.com) (payment method required even for small apps)
2. Install CLI: [Heroku CLI for Windows](https://devcenter.heroku.com/articles/heroku-cli)
3. In PowerShell:
   ```powershell
   heroku --version
   heroku login
   ```

### 2. MongoDB Atlas (your cluster)

Follow [MONGODB_ATLAS_SETUP.md](MONGODB_ATLAS_SETUP.md):

- New project (do **not** reuse old `finsync.xwmeuwe` credentials from [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))
- M0 cluster, region **Mumbai** (`ap-south-1`) for India
- Network access: `0.0.0.0/0` (allows Heroku)
- Connection string: `mongodb+srv://USER:PASS@cluster.mongodb.net/finsync360?retryWrites=true&w=majority`

### 3. Razorpay

- Enable **Subscriptions**
- Webhook URL: `https://api.aiminfocom.com/api/billing/webhook` (set after DNS is live)
- Events: per [docs/LICENSING.md](docs/LICENSING.md)

### 4. Generate secrets (never commit)

- `JWT_SECRET`, `ENCRYPTION_KEY` (32 chars), `DESKTOP_AGENT_API_KEY`

---

## Phase 1 — Create and deploy backend on Heroku

### Step 1: Create backend app

```powershell
cd d:\Rizwan\Tally_sync
heroku create aiminfo-finsync-api
```

Your default URL will be: `https://aiminfo-finsync-api.herokuapp.com` (use until custom domain is ready).

Link remote:

```powershell
heroku git:remote -a aiminfo-finsync-api -r heroku-backend
```

### Step 2: Set production config vars

```powershell
heroku config:set NODE_ENV=production -a aiminfo-finsync-api
heroku config:set MONGODB_URI="mongodb+srv://YOUR_USER:YOUR_PASS@YOUR_CLUSTER.mongodb.net/finsync360?retryWrites=true&w=majority" -a aiminfo-finsync-api
heroku config:set JWT_SECRET="YOUR_LONG_RANDOM_SECRET" -a aiminfo-finsync-api
heroku config:set ENCRYPTION_KEY="YOUR_32_CHARACTER_KEY_HERE12" -a aiminfo-finsync-api
heroku config:set BCRYPT_ROUNDS=12 -a aiminfo-finsync-api
heroku config:set LICENSE_ENFORCEMENT=true -a aiminfo-finsync-api
heroku config:set DEVICE_TOKEN_EXPIRE=30d -a aiminfo-finsync-api
heroku config:set DESKTOP_AGENT_API_KEY="YOUR_AGENT_KEY" -a aiminfo-finsync-api
heroku config:set FRONTEND_URL="https://www.aiminfocom.com" -a aiminfo-finsync-api
heroku config:set CORS_ORIGIN="https://www.aiminfocom.com,https://aiminfocom.com" -a aiminfo-finsync-api
heroku config:set RAZORPAY_KEY_ID="rzp_live_xxx" -a aiminfo-finsync-api
heroku config:set RAZORPAY_KEY_SECRET="xxx" -a aiminfo-finsync-api
heroku config:set RAZORPAY_WEBHOOK_SECRET="xxx" -a aiminfo-finsync-api
```

Verify:

```powershell
heroku config -a aiminfo-finsync-api
```

### Step 3: Deploy backend (monorepo subtree)

From repo root (Git Bash or PowerShell with git):

```powershell
git subtree split --prefix=backend -b deploy-backend
git push heroku-backend deploy-backend:main --force
```

If Heroku expects `master`:

```powershell
git push heroku-backend deploy-backend:master --force
```

Or use interactive script (Git Bash): [heroku-deploy.sh](heroku-deploy.sh) — enter `aiminfo-finsync-api` as backend name.

### Step 4: Scale to exactly one web dyno

```powershell
heroku ps:scale web=1 -a aiminfo-finsync-api
heroku ps -a aiminfo-finsync-api
heroku logs --tail -a aiminfo-finsync-api
```

Logs should show MongoDB connected and Tally WebSocket service started.

### Step 5: Verify (Heroku URL first)

```powershell
curl https://aiminfo-finsync-api.herokuapp.com/health
curl https://aiminfo-finsync-api.herokuapp.com/api/health
```

### Step 6: Create admin user

```powershell
heroku run npm run create:admin -a aiminfo-finsync-api
```

---

## Phase 2 — Custom domain api.aiminfocom.com on Heroku

### Step 1: Add domain in Heroku

```powershell
heroku domains:add api.aiminfocom.com -a aiminfo-finsync-api
heroku domains -a aiminfo-finsync-api
```

Heroku prints a **DNS target** (e.g. `something.herokudns.com`).

### Step 2: DNS at your domain registrar (aiminfocom.com)

Add record:

| Type | Name | Value |
|------|------|--------|
| **CNAME** | `api` | Target from `heroku domains` (e.g. `xxx.herokudns.com`) |

Wait 5–60 minutes for DNS propagation.

### Step 3: SSL

Heroku **Automatic Certificate Management (ACM)** issues SSL for custom domains on paid dynos. Enable if prompted:

```powershell
heroku certs:auto:enable -a aiminfo-finsync-api
```

### Step 4: Verify custom domain

```powershell
curl https://api.aiminfocom.com/health
curl https://api.aiminfocom.com/api/health
```

### Marketing site (www.aiminfocom.com)

Options:

| Option | How |
|--------|-----|
| **A — Simple** | Point `www` CNAME to Netlify/Vercel static site (download page only) |
| **B — Heroku** | Deploy [frontend-nextjs](frontend-nextjs/) as separate app `aiminfo-finsync-web`, add `www.aiminfocom.com` there |
| **C — Same registrar** | Website builder on `www` at GoDaddy/Namecheap |

For apex `aiminfocom.com` → redirect to `www` (registrar redirect or Cloudflare).

Update backend when web is live:

```powershell
heroku config:set FRONTEND_URL="https://www.aiminfocom.com" -a aiminfo-finsync-api
```

---

## Phase 3 — Point clients to api.aiminfocom.com

Update before building customer installers/APK:

| File | Change |
|------|--------|
| [mobile/.env.production](mobile/.env.production) | `API_BASE_URL=https://api.aiminfocom.com/api`, `WEBSOCKET_URL=wss://api.aiminfocom.com` |
| [mobile/src/services/apiClient.ts](mobile/src/services/apiClient.ts) | Production fallback URL |
| [desktop-agent/src/services/ConfigManager.js](desktop-agent/src/services/ConfigManager.js) | Default `apiUrl` / `wss` for release builds |
| [backend/src/server.js](backend/src/server.js) | Add `https://www.aiminfocom.com` to CORS `allowedOrigins` |

Build agent:

```powershell
cd d:\Rizwan\Tally_sync\desktop-agent
npm install
npm run build
npm run electron:dist
```

Host installer at `https://www.aiminfocom.com/download`.

Build mobile:

```powershell
cd mobile
node switch-environment.js production
cd android
.\gradlew bundleRelease
```

---

## Phase 4 — Customer setup (unchanged flow)

On each customer Tally PC:

1. Install **desktop-agent** from your website
2. TallyPrime open; **ODBC/XML port 9000** enabled
3. Log in (same account as mobile)
4. Agent uses `https://api.aiminfocom.com/api` and `wss://api.aiminfocom.com/tally-agent`
5. Link Tally company → device activate → sync
6. Mobile: login → select company → view data

Billing: trial 7 days / 1 PC → Razorpay via mobile or agent ([post-launch_customer_journey_5ac4b106.plan.md](post-launch_customer_journey_5ac4b106.plan.md)).

---

## Phase 5 — Optional Heroku apps

| App | Heroku name example | Custom domain | Required? |
|-----|---------------------|---------------|-----------|
| Backend | `aiminfo-finsync-api` | `api.aiminfocom.com` | **Yes** |
| Web admin | `aiminfo-finsync-web` | `www.aiminfocom.com` or `admin.aiminfocom.com` | No (marketing can be static) |
| ML service | `aiminfo-finsync-ml` | none (internal) | No |

ML deploy (optional):

```powershell
heroku create aiminfo-finsync-ml
heroku buildpacks:set heroku/python -a aiminfo-finsync-ml
# subtree push ml-service/, set MONGODB_URL, BACKEND_API_URL
heroku config:set ML_SERVICE_URL="https://aiminfo-finsync-ml.herokuapp.com" -a aiminfo-finsync-api
```

---

## Phase 6 — Production verification checklist

| # | Check | URL |
|---|--------|-----|
| 1 | Health | `https://api.aiminfocom.com/health` |
| 2 | Register/login | Mobile + agent |
| 3 | Tally connection | Agent test on port 9000 |
| 4 | Device activate | `POST /api/devices/activate` |
| 5 | WebSocket | Agent log: `wss://api.aiminfocom.com/tally-agent` |
| 6 | Sync → Atlas | Vouchers/parties in Atlas |
| 7 | Mobile data | Same company shows vouchers |
| 8 | Razorpay | Webhook + subscription `active` |
| 9 | Dyno count | `heroku ps` shows **web=1** only |

Run: `cd mobile && node test-full-integration.js` (update test config to `api.aiminfocom.com` first).

---

## What NOT to use

- Old URLs: `finsync-backend-d34180691b06.herokuapp.com` in [mobile/.env.production](mobile/.env.production)
- Credentials in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — create fresh Atlas user
- `NODE_ENV=development` on Heroku (use **`production`**)
- `heroku ps:scale web=2` without Redis WebSocket scaling

---

## Recommended order of work

1. MongoDB Atlas (your cluster, Mumbai)  
2. Heroku: `aiminfo-finsync-api` + config vars + subtree deploy + **web=1**  
3. DNS: `api.aiminfocom.com` → Heroku CNAME + SSL  
4. Razorpay webhook on `api.aiminfocom.com`  
5. Update mobile/agent env URLs → build installer + Android release  
6. `www.aiminfocom.com` marketing page + agent download  
7. Pilot one Tally PC → full verification checklist  
8. Optional: ML + web admin on Heroku  

**VPS alternative:** Still valid if Heroku cost or dyno limits become an issue later; same `api.aiminfocom.com` DNS would point to VPS IP instead of Heroku CNAME.

---

After you approve this plan, say **"execute the plan"** to start implementation (env URL updates, CORS, deploy commands on your machine).
