# Hosting the FinSync360 Backend on Oracle Cloud (Always Free)

This guide moves **only the backend** off Railway and onto an Oracle Cloud "Always
Free" VM. Your database stays on MongoDB Atlas — you just point the new server at it.

End result: an always-on server (no sleeping, stable WebSockets for the desktop
agent and mobile app) for **$0/month**.

---

## What the backend needs (why the steps below exist)

- Node.js 18, Express, runs on **port 5000**, health endpoint `GET /health`.
- **Two** WebSocket surfaces, both must be reachable over secure `wss://`:
  - Socket.io — mobile realtime clients
  - `tallyWebSocketService` at path **`/tally-agent`** — the desktop agent
- Mobile + desktop agent connect over `https://` / `wss://`, so the server **must
  have TLS (a real HTTPS certificate)**. That requires a domain name pointing at the
  VM. We use a free DuckDNS subdomain + Caddy (which gets and auto-renews the cert
  for you). This is the simplest reliable path.

---

## Part 0 — Prerequisites (5 min)

1. Oracle Cloud account: https://www.oracle.com/cloud/free/ (requires a card for
   identity verification; Always Free resources are never charged).
2. A free domain for TLS: create one at https://www.duckdns.org (sign in with
   Google/GitHub). You'll get something like `finsync360.duckdns.org`. Leave the IP
   blank for now — you'll set it after the VM is created.

---

## Part 1 — Create the Always Free VM (10 min)

1. Oracle Console → **Menu → Compute → Instances → Create instance**.
2. **Image and shape:**
   - Image: **Ubuntu 22.04**.
   - Shape: click *Change shape* → **Ampere (ARM)** → `VM.Standard.A1.Flex`.
     Set **1–2 OCPU and 6–12 GB RAM** (all within Always Free; A1 free allowance is
     4 OCPU / 24 GB total).
   - If ARM capacity is unavailable in your region, fall back to
     `VM.Standard.E2.1.Micro` (AMD, also Always Free, 1 GB RAM — still fine).
3. **SSH keys:** choose *Generate a key pair* and **download the private key**
   (you'll need it to log in). Save it as `oracle_key.pem`.
4. **Networking:** keep "Create new VCN" + "Assign a public IPv4 address" (default).
5. Click **Create**. Wait until it shows **Running**, then copy the **Public IP
   address**.
6. Go back to DuckDNS and set your subdomain's IP to this Public IP. Save.

### 1a. Open the firewall — TWO layers (this is the #1 gotcha)

Oracle blocks inbound traffic in two independent places. You must open **both**.

**Layer 1 — VCN Security List (cloud firewall):**
- Console → Networking → Virtual Cloud Networks → your VCN → **Subnet** →
  **Default Security List** → **Add Ingress Rules**:
  - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**
  - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **443**
  - (Port 22 for SSH is already open by default.)

**Layer 2 — the VM's own iptables (Ubuntu images ship with a restrictive rule
set).** Do this after you SSH in (next part):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Part 2 — Connect and install runtime (10 min)

From your PC (Git Bash / PowerShell), `cd` to where you saved the key:

```bash
chmod 600 oracle_key.pem            # Git Bash; on PowerShell this is unnecessary
ssh -i oracle_key.pem ubuntu@YOUR_PUBLIC_IP
```

Then on the VM:

```bash
# System update
sudo apt update && sudo apt upgrade -y

# Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

# Build deps for native modules used by this backend (sharp, canvas/pdfkit, bcrypt)
sudo apt install -y python3 make g++ \
  libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev

# PM2 (keeps the app running + restarts on crash/reboot)
sudo npm install -g pm2

node -v   # should print v18.x
```

Now run the iptables commands from **Part 1a, Layer 2**.

---

## Part 3 — Deploy the backend (10 min)

```bash
cd ~
git clone YOUR_REPO_URL finsync360
cd finsync360/backend

npm install --omit=dev
```

> If your repo is private, generate a deploy key on the VM
> (`ssh-keygen -t ed25519`), add the public key to GitHub → repo → Settings →
> Deploy keys, then clone via the SSH URL (`git@github.com:...`).

### 3a. Create the production `.env`

```bash
nano ~/finsync360/backend/.env
```

Paste the following and fill in **your real values**. Pull the secrets from your
current Railway project's Variables tab so they match exactly:

```env
NODE_ENV=production
PORT=5000

# Your existing Atlas connection string (unchanged)
MONGODB_URI=mongodb+srv://<user>:<pass>@finsync360-prod.w9gspv9.mongodb.net/finsync360?retryWrites=true&w=majority

JWT_SECRET=<same value as on Railway>
JWT_EXPIRE=30d
JWT_REFRESH_EXPIRE=90d
ENCRYPTION_KEY=<same value as on Railway>

# Allow your frontend + mobile origins (comma separated). Use * only to test.
CORS_ORIGIN=https://your-frontend-domain.com

# Carry over any of these you actually use:
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
DESKTOP_AGENT_API_KEY=...
EMAIL_USER=...
EMAIL_PASS=...
LICENSE_ENFORCEMENT=true
```

> ⚠️ **Rotate your secrets.** The committed `backend/.env.example` contains what
> look like real Atlas credentials, `JWT_SECRET`, and `ENCRYPTION_KEY`. Anyone with
> repo access has them. Change the Atlas DB password and generate new
> `JWT_SECRET`/`ENCRYPTION_KEY` while you're setting this up, and put the new values
> here. (Rotating JWT_SECRET logs everyone out once — expected.)

### 3b. Allow Atlas to accept connections from the VM

MongoDB Atlas → your cluster → **Network Access → Add IP Address** → add the VM's
**Public IP** (or `0.0.0.0/0` to allow anywhere; tighter is better — use the VM IP).

### 3c. Start with PM2

This backend has a web process **and** a background worker (see `Procfile`). Run
both:

```bash
cd ~/finsync360/backend
pm2 start src/server.js --name finsync-api
pm2 start src/workers/backgroundJobs.js --name finsync-worker
pm2 save
pm2 startup    # run the command it prints, so PM2 restarts on reboot

pm2 logs finsync-api   # confirm: "MongoDB connected" + listening on 5000
```

Quick local check on the VM:

```bash
curl http://localhost:5000/health   # expect HTTP 200
```

---

## Part 4 — HTTPS + WebSocket reverse proxy with Caddy (10 min)

Caddy automatically obtains and renews a Let's Encrypt certificate and transparently
proxies both WebSocket surfaces. Much simpler than nginx + certbot.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Edit the config:

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace its contents with (use **your** DuckDNS domain):

```
finsync360.duckdns.org {
    reverse_proxy localhost:5000
}
```

That single block handles `/api`, the Socket.io upgrade, **and** `/tally-agent` —
Caddy forwards WebSocket upgrades automatically, no extra config.

```bash
sudo systemctl restart caddy
sudo systemctl status caddy   # should be active (running)
```

Verify from your own PC:

```bash
curl https://finsync360.duckdns.org/health   # expect 200 over HTTPS
```

Your backend base URL is now: **`https://finsync360.duckdns.org`**

---

## Part 5 — Point the clients at the new server

Replace the old Railway host `web-production-577680.up.railway.app` everywhere.
New host: `finsync360.duckdns.org`.

**1. Desktop agent** — `desktop-agent/config/serverDefaults.js`:
```js
url:    'wss://finsync360.duckdns.org/tally-agent',
apiUrl: 'https://finsync360.duckdns.org/api',
```

**2. Mobile** — `mobile/.env` and `mobile/.env.production`:
```env
REACT_APP_API_URL=https://finsync360.duckdns.org/api
API_BASE_URL=https://finsync360.duckdns.org/api
WEBSOCKET_URL=wss://finsync360.duckdns.org
TALLY_AGENT_URL=wss://finsync360.duckdns.org/tally-agent
```

**3. Frontend (Next.js)** — set `NEXT_PUBLIC_API_URL=https://finsync360.duckdns.org/api`
in your frontend host's env, then redeploy.

Also make sure `CORS_ORIGIN` in the VM's `.env` includes your deployed frontend
origin, then `pm2 restart finsync-api`.

Rebuild/redistribute the mobile app and desktop agent so they ship the new URLs.

---

## Part 6 — Validate end to end

1. `curl https://finsync360.duckdns.org/health` → 200.
2. Open Tally, start the desktop agent → in `pm2 logs finsync-api` you should see the
   `/tally-agent` socket connect; run a sync.
3. Open the mobile app → confirm data loads and realtime updates arrive.
4. Once everything works, **shut down the Railway service** to stop the bill.

---

## Updating the backend later

```bash
cd ~/finsync360 && git pull
cd backend && npm install --omit=dev
pm2 restart finsync-api finsync-worker
```

## Handy commands

| Task | Command |
|---|---|
| App logs | `pm2 logs finsync-api` |
| Restart app | `pm2 restart finsync-api` |
| Status | `pm2 status` |
| Caddy logs | `sudo journalctl -u caddy -f` |
| Renew cert | automatic (Caddy) |

---

## Cost summary

| Component | Where | Cost |
|---|---|---|
| Backend VM | Oracle Always Free (A1/E2.Micro) | $0 |
| Database | MongoDB Atlas M0 | $0 |
| Domain/TLS | DuckDNS + Caddy/Let's Encrypt | $0 |

**Total: $0/month, always-on.**

### Trade-off vs. Railway
You now self-manage the VM (OS updates, the occasional restart). Oracle has also been
known to reclaim *idle* Always Free A1 instances — keeping the app + Caddy running
(as here) generally avoids that, but take a periodic Atlas backup regardless. If you
ever want managed simplicity back without Railway's price, Fly.io (~$2–5/mo) is the
middle ground.
