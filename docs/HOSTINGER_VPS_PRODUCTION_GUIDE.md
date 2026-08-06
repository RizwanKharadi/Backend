# Hostinger VPS production guide — TallyFin backend + MySQL

Written for someone who has never used a VPS before. Follow the parts in order.
Every command can be copy-pasted exactly — the real domain, IP, and username are
already filled in. Only `DB_PASSWORD` and the generated secrets are yours to
substitute as you go.

**Target setup**

- Hostinger VPS **KVM 1** (1 vCPU, 4 GB RAM, 50 GB NVMe) — enough for the
  backend + MySQL for your first customers
- **Ubuntu 24.04 LTS, plain OS image** (not an application template)
- MySQL 8 listening on `127.0.0.1` only — never exposed to the internet
- Node 20 LTS running `src/server.js` on port 5000, kept alive by PM2
- Nginx in front on ports 80/443 with a free Let's Encrypt TLS certificate
- Public API at `https://api.aiminfocom.com`

**This deployment's actual values**

| Thing | Value |
| --- | --- |
| VPS | Hostinger KVM 1, `srv1866897.hstgr.cloud`, India – Mumbai 2 |
| Public IPv4 | `187.127.164.88` |
| OS | Ubuntu 24.04 LTS |
| Domain | `aiminfocom.com` (registrar/DNS: **BigRock**) |
| API hostname | `api.aiminfocom.com` |
| Linux user you will create | `rizwan` |
| MySQL database / user | `tallyfin` / `tallyfin@localhost` |
| `DB_PASSWORD` | you generate it in Part 6 |

> The existing website on `aiminfocom.com` (currently at `216.10.252.31`, BigRock
> shared hosting) is **not touched** by anything in this guide. We only add an
> `api` subdomain. Do not change the domain's nameservers.

---

## Part 0 — How the pieces fit together

```
Mobile app (Android)  ──HTTPS──┐
                               │
Desktop agent (Tally PC) ─WSS──┤
                               ▼
                    ┌──────────────────────────┐
                    │  Nginx  :80 / :443       │  ← Let's Encrypt TLS
                    │  api.aiminfocom.com      │
                    └───────────┬──────────────┘
                                │ plain HTTP, localhost only
                                ▼
                    ┌──────────────────────────┐
                    │  Node backend  :5000     │  ← PM2 keeps it running
                    │  REST + /tally-agent WS  │
                    │  + /socket.io realtime   │
                    └───────────┬──────────────┘
                                │ localhost only
                                ▼
                    ┌──────────────────────────┐
                    │  MySQL 8  127.0.0.1:3306 │
                    │  database: tallyfin      │
                    └──────────────────────────┘
```

Only ports **22 (SSH), 80, and 443** are reachable from the internet. MySQL and
Node are not. This is the single most important security property of the setup —
do not "fix" a connection problem by opening port 3306.

---

## Part 1 — Ordering the VPS ✅ done

> Already completed: KVM 1, Ubuntu 24.04 LTS, India – Mumbai 2, weekly snapshot
> backups enabled. Kept here for reference and for when you provision a second
> server. **Skip to Part 2.**
>
> One thing left to do in hPanel: turn on **Auto-renewal** (currently off,
> expiring 2026-08-30). If the VPS lapses, your customers' app stops working.

### Which OS to choose

Hostinger's order flow offers **Plain OS** images and **OS with application**
templates (including MySQL, and various panels).

**Choose: Plain OS → Ubuntu → Ubuntu 24.04 LTS.**

Reasons, since you asked which fits our flow:

- Your `deployment/hostinger-bootstrap.sh` installs MySQL 8, Node 20, Nginx,
  Certbot, PM2, and the firewall in one run — the application template only
  saves you one `apt install` line, and it puts MySQL's root password and config
  in a location that varies by template, which makes every later instruction
  less predictable.
- Ubuntu 24.04 LTS is supported until 2029 and has the best documentation for
  MySQL 8 + Nginx + Certbot, which matters when you are troubleshooting alone.
- Avoid templates that bundle a control panel (CyberPanel, CloudPanel, Plesk,
  aaPanel). They install their own Nginx/Apache and their own MySQL, which will
  fight with the configuration in this guide.

So: **plain Ubuntu 24.04 LTS. MySQL gets installed by our own script**, and it
gets installed correctly bound to localhost.

### Other order-flow choices

- **Datacenter location**: pick **India (Mumbai)** if your customers are in
  India. Latency matters for the Tally sync, which is chatty.
- **Hostname**: anything, e.g. `tallyfin-prod`.
- **Root password**: generate a long random one and save it in your password
  manager. You will barely use it.
- **SSH key**: if the order flow offers to add an SSH key, do it (Part 3 shows
  how to generate one). If not, you can add it later.
- **Backups**: Hostinger's weekly/daily VPS snapshot add-on is worth the small
  cost. It protects against you breaking the whole server. It is **not** a
  substitute for the database backups in Part 14 — snapshots are coarse and
  restoring one rolls back everything.
- **Monarx / malware scanner**: optional, skip for now.

After the VPS is provisioned, hPanel shows your **public IPv4 address**. Note it
down — that is `187.127.164.88`.

---

## Part 2 — Point your domain at the VPS

`aiminfocom.com` uses BigRock's nameservers (`sns407.bigrock.com`,
`sns408.bigrock.com`) and the website itself lives on BigRock shared hosting at
`216.10.252.31`. So the DNS record goes in **BigRock's panel, not Hostinger's
hPanel** — hPanel only manages domains registered with Hostinger.

You need exactly one new record. Nothing existing gets modified:

| Type | Host / Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `api` | `187.127.164.88` | lowest offered (BigRock's minimum is usually 14400) |

### How to add it at BigRock

1. Sign in at **manage.bigrock.in** (the customer control panel, not the website
   builder).
2. Go to **Manage Orders → List/Search Orders**, then click **aiminfocom.com**.
3. On the domain's page, find **DNS Management** (BigRock also labels this "Manage
   DNS" or shows it under the Name Servers section). Open it.
4. Select the **A Records** tab, then **Add A Record**.
5. Fill in:
   - **Host Name**: `api` — just `api`, not `api.aiminfocom.com`. BigRock appends
     the domain automatically. Entering the full name creates
     `api.aiminfocom.com.aiminfocom.com`, which is the single most common mistake
     here.
   - **Destination IPv4 Address**: `187.127.164.88`
   - **TTL**: the lowest value the form accepts
6. Save.

Leave every other record alone. In particular do **not** touch the root `@` / `A`
record pointing at `216.10.252.31` — that is your live website, and changing it
would take the site offline.

Do **not** put Cloudflare or any proxy/CDN in front of `api.aiminfocom.com` yet.
Get plain TLS working first — a proxy changes how Certbot validates and how
WebSockets are forwarded, and you would be debugging two systems at once.

### Verify DNS before continuing

From your Windows PowerShell:

```bash
nslookup api.aiminfocom.com 8.8.8.8
```

It must return `187.127.164.88`. Because BigRock enforces a 14400-second (4-hour)
TTL, allow **up to 4 hours** — though a brand-new record that never existed
before usually appears within 15–30 minutes.

**Do not run Certbot (Part 11) until this resolves correctly.** Let's Encrypt
validates by connecting to `api.aiminfocom.com`, and failed attempts count
against a rate limit that will lock you out for an hour.

You can do Parts 3 through 10 while DNS propagates — only Part 11 needs it.

---

## Part 3 — Connect to the VPS from Windows

Windows 10 has a built-in SSH client, so you do not need PuTTY.

### 3a. Create an SSH key (do this once, on your PC)

In PowerShell:

```bash
ssh-keygen -t ed25519 -C "rizwan-tallyfin"
```

Press Enter to accept the default path (`C:\Users\admin\.ssh\id_ed25519`). Set a
passphrase if you want extra safety. This creates two files:

- `id_ed25519` — **private key, never share this, never commit it**
- `id_ed25519.pub` — public key, safe to paste anywhere

Show the public key:

```bash
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

### 3b. First login as root

```bash
ssh root@187.127.164.88
```

Type `yes` at the fingerprint prompt, then enter the root password from Part 1.
You are now on the server. The prompt changes to something like
`root@tallyfin-prod:~#`.

---

## Part 4 — Create a non-root user

Working as `root` all the time means one typo can destroy the server. Create a
normal user with `sudo` rights.

Run these **on the VPS, as root**:

```bash
adduser rizwan
```

It asks for a password (save it — you will type it for `sudo`) and then some
optional details you can skip with Enter.

Grant admin rights:

```bash
usermod -aG sudo rizwan
```

Copy your SSH key so you can log in as that user without a password:

```bash
mkdir -p /home/rizwan/.ssh
nano /home/rizwan/.ssh/authorized_keys
```

Paste the **whole** `id_ed25519.pub` line from step 3a. Save with `Ctrl+O`,
`Enter`, then exit with `Ctrl+X`. Fix permissions:

```bash
chown -R rizwan:rizwan /home/rizwan/.ssh
chmod 700 /home/rizwan/.ssh
chmod 600 /home/rizwan/.ssh/authorized_keys
```

### Test it before locking anything down

Open a **second** PowerShell window (keep the root session open as a lifeline):

```bash
ssh rizwan@187.127.164.88
```

You should get in with no password prompt. If that works, harden SSH — back in
the **root** session:

```bash
nano /etc/ssh/sshd_config
```

Set these three lines (they may exist commented out with a `#`; remove the `#`
and change the value):

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Then:

```bash
systemctl restart ssh
```

Now root login and password guessing are both off. **Only your key can get in —
if you lose that private key you lose access to the server**, so back it up.
(Hostinger's browser terminal in hPanel remains as an emergency door.)

From here on, work as `rizwan`.

---

## Part 5 — Install the software stack

You deploy the **standalone backend repo**, `RizwanKharadi/Backend`. Its root *is*
the backend — `src/`, `scripts/`, and `package.json` sit at the top level, with no
`backend/` subfolder. So the app root on the server is:

```
/var/www/tallyfin/          ← repo root
├── src/server.js             ← what PM2 runs
├── scripts/
├── package.json
└── .env                      ← you create this in Part 7
```

> **Note:** the `Backend` repo does **not** contain the `deployment/` folder —
> `hostinger-bootstrap.sh` and `nginx-tallyfin.conf` live in the main
> `Tally_sync` repo on your PC. Step 5b copies them across. Don't look for them in
> the clone.

### 5a. Clone the backend

As `rizwan`:

```bash
sudo apt update && sudo apt install -y git
sudo mkdir -p /var/www/tallyfin
sudo chown $USER:$USER /var/www/tallyfin
```

`RizwanKharadi/Backend` is a **public** repo, so no credentials or token are
needed:

```bash
git clone https://github.com/RizwanKharadi/Backend.git /var/www/tallyfin
```

> Because the repo is public, treat every commit to it as world-readable. `.env`
> is gitignored and must stay that way — never commit real credentials, and if you
> ever do, rotate the secret rather than just deleting the line (git history keeps
> it). If you later make the repo private, clone with a fine-grained read-only
> personal access token instead: `https://TOKEN@github.com/...`.

### 5b. Copy the deployment files from your PC

Open a **new PowerShell window on your Windows PC** (not the SSH session) and run:

```bash
scp D:\Rizwan\Tally_sync\deployment\hostinger-bootstrap.sh D:\Rizwan\Tally_sync\deployment\nginx-tallyfin.conf rizwan@187.127.164.88:/home/rizwan/
```

They go to your home directory, not into the clone — that keeps the repo's working
tree clean so `git pull` stays trouble-free later.

### 5c. Run the bootstrap

Back in the SSH session:

```bash
cd ~
bash hostinger-bootstrap.sh
```

This takes a few minutes and will ask for your `sudo` password. It installs
MySQL 8, Node 20, Nginx, Certbot, PM2, `ufw` (firewall), and `fail2ban`, adds a
2 GB swap file, sets the timezone to Asia/Kolkata, enables automatic security
updates, and binds MySQL to `127.0.0.1`.

The script is safe to re-run if it fails partway.

Sanity check when it finishes:

```bash
node -v          # should print v20.x
mysql --version  # should print 8.0.x
sudo ufw status  # 22, 80, 443 allowed; nothing else
```

---

## Part 6 — Set up MySQL

### 6a. Run the security wizard

```bash
sudo mysql_secure_installation
```

Answer as follows:

- **VALIDATE PASSWORD component?** → `n` (it makes automated password handling
  awkward; we use a long random password anyway)
- **Change the root password?** → if it asks, you can skip; Ubuntu's MySQL root
  uses socket authentication, so `sudo mysql` works without a password and no
  remote root login exists
- **Remove anonymous users?** → `y`
- **Disallow root login remotely?** → `y`
- **Remove test database?** → `y`
- **Reload privilege tables?** → `y`

### 6b. Generate a database password

```bash
openssl rand -base64 24
```

Copy the output — this is `DB_PASSWORD`. Save it in your password manager now.

### 6c. Create the database and app user

```bash
sudo mysql
```

At the `mysql>` prompt, paste this (with your real password substituted):

```sql
CREATE DATABASE tallyfin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tallyfin'@'localhost' IDENTIFIED BY 'DB_PASSWORD';
GRANT ALL PRIVILEGES ON tallyfin.* TO 'tallyfin'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Notes:

- `utf8mb4` matters — Tally ledger names contain `₹`, regional characters, and
  occasionally emoji. The older `utf8` would corrupt them.
- `'tallyfin'@'localhost'` means this user **cannot** connect from anywhere but
  the server itself. Combined with `bind-address = 127.0.0.1` and the firewall,
  your database has three independent layers of protection.
- Grants are scoped to `tallyfin.*` only, not the whole server.

Confirm it works:

```bash
mysql -u tallyfin -p -e "SHOW DATABASES;"
```

Enter `DB_PASSWORD`. You should see `tallyfin` listed.

---

## Part 7 — Configure the backend environment

```bash
cd /var/www/tallyfin
cp .env.example .env
```

Generate two secrets — run each and keep the output:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY (must be 64 hex chars)
```

Also generate one for the desktop agent:

```bash
openssl rand -hex 32      # DESKTOP_AGENT_API_KEY
```

Now edit the file:

```bash
nano .env
```

These are the values that **must** change from the example — everything else can
stay at its default for launch:

```ini
NODE_ENV=production
PORT=5000

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=tallyfin
MYSQL_PASSWORD=DB_PASSWORD
MYSQL_DATABASE=tallyfin

# Your own login for the app. The seed script refuses placeholder
# @tallyfin.com addresses on purpose.
ADMIN_EMAIL=you@aiminfocom.com
ADMIN_PASSWORD=a-strong-password-you-will-actually-type
ADMIN_NAME=Rizwan
ADMIN_PHONE=+91XXXXXXXXXX

JWT_SECRET=<paste openssl rand -base64 48 output>
ENCRYPTION_KEY=<paste openssl rand -hex 32 output>

DESKTOP_AGENT_API_KEY=<paste the third openssl output>

FRONTEND_URL=https://api.aiminfocom.com

LOG_LEVEL=info
SWAGGER_ENABLED=false
```

Important points:

- **`NODE_ENV=production` is not optional.** In `development`, the backend
  continues running even when MySQL is unreachable
  (`backend/src/config/database.js:87`), which would let the app come up and
  silently serve nothing. In production it exits instead, so PM2 restarts it and
  you see the real failure in the logs.
- **`SWAGGER_ENABLED=false`** — do not publish your full API surface to the
  internet on day one. Flip it to `true` temporarily if you need the docs.
- Mobile apps send no `Origin` header, so CORS allows them regardless
  (`backend/src/server.js:86`). `FRONTEND_URL` only matters once you host a web
  dashboard.
- **`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are required, not optional.**
  They are what lets anyone pay you. Without them every "Pay with Razorpay"
  attempt fails with a 503 `Razorpay is not configured`
  (`backend/src/services/subscriptionBillingService.js:100`). Once a customer's
  trial ends the licence middleware returns 402 on every report route
  (`backend/src/middleware/license.js:32`); the billing routes themselves stay
  open so they can still subscribe, but only if these keys are set. If you are
  migrating from another
  host, these keys do **not** come across: `.env` is gitignored, so copy them
  from that provider's variables into this file by hand.
- Twilio / OpenAI / GSTN keys: fill them in only when you actually enable those
  features. Leave the example placeholders otherwise.
- After saving, lock the file down — it contains every secret you have:

```bash
chmod 600 /var/www/tallyfin/.env
```

`.env` is gitignored, so it never travels back to GitHub. It also means **`.env`
is not backed up by git** — keep a copy of these values in your password
manager.

---

## Part 8 — Install dependencies and create the schema

```bash
cd /var/www/tallyfin
npm install --omit=dev
```

This takes several minutes; `sharp` compiles native code. If it gets killed, the
swap file from Part 5 is what prevents that — confirm with `free -h` that swap
exists.

> **Why `npm install` and not `npm ci`:** the `Backend` repo has no
> `package-lock.json`, and `npm ci` refuses to run without one. The tradeoff is
> that `npm install` resolves versions fresh each time, so two deploys a month
> apart can pull different patch versions — a dependency can break your build
> without any change on your side. Generating a lockfile and committing it to the
> `Backend` repo is worth doing before you have many customers; after that, switch
> this command back to `npm ci`.

Now seed your admin user. This also creates every table, because `connectDB()`
runs `sequelize.sync()` on connect:

```bash
node scripts/create-single-admin.js
```

Expect output confirming the admin was created. Verify the tables exist:

```bash
mysql -u tallyfin -p tallyfin -e "SHOW TABLES;"
```

---

## Part 9 — Run the backend under PM2

PM2 restarts the app if it crashes and starts it again after a server reboot.

```bash
cd /var/www/tallyfin
pm2 start src/server.js --name tallyfin-backend --time
pm2 logs tallyfin-backend --lines 50
```

You are looking for `MySQL Connected`, `MySQL schema synchronized`, and
`TallyFin Backend Server running on port 5000 in production mode`. Press
`Ctrl+C` to stop tailing logs (the app keeps running).

Test it locally on the server:

```bash
curl http://127.0.0.1:5000/health
```

You should get a JSON response. If this works, the app is fine and anything
broken later is Nginx, DNS, or TLS.

Make it survive reboots:

```bash
pm2 save
pm2 startup
```

`pm2 startup` prints a `sudo env PATH=... ` command. **Copy that exact line and
run it.** Then reboot once to prove it works:

```bash
sudo reboot
```

Wait ~30 seconds, reconnect, and check:

```bash
pm2 status
curl http://127.0.0.1:5000/health
```

---

## Part 10 — Put Nginx in front

```bash
sudo cp /home/rizwan/nginx-tallyfin.conf /etc/nginx/sites-available/tallyfin
sudo sed -i 's/api\.YOURDOMAIN\.com/api.aiminfocom.com/g' /etc/nginx/sites-available/tallyfin
sudo ln -sf /etc/nginx/sites-available/tallyfin /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
```

`nginx -t` must say `syntax is ok` / `test is successful`. Then:

```bash
sudo systemctl reload nginx
```

Test over plain HTTP from your PC:

```bash
curl http://api.aiminfocom.com/health
```

If this returns JSON, Nginx and DNS are both correct.

The config handles three kinds of traffic separately, which is why it is worth
using rather than a generic proxy snippet:

- `/tally-agent` — the desktop agent's WebSocket, with a 24-hour read timeout so
  idle agents are not disconnected
- `/socket.io/` — the mobile app's realtime channel, same treatment
- `/` — normal REST calls, with a 120-second timeout for slow Tally pulls and
  large reports

---

## Part 11 — Enable HTTPS

This is mandatory, not optional: Android 9+ blocks cleartext HTTP by default, and
Google Play will not accept an app that talks to a plain-HTTP API.

**Confirm `nslookup api.aiminfocom.com` returns `187.127.164.88` before running this.**

```bash
sudo certbot --nginx -d api.aiminfocom.com
```

Answer the prompts:

- **Email** — use a real one; this is where expiry warnings go
- **Terms of service** — you must accept to use Let's Encrypt
- **Share email with EFF** — your choice, `n` is fine
- **Redirect HTTP to HTTPS** — choose **yes / option 2**

Certbot edits your Nginx file to add the TLS listener and reloads Nginx.
Certificates last 90 days and renew automatically via a systemd timer. Verify
the automation:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

Test the real endpoint from your PC:

```bash
curl https://api.aiminfocom.com/health
```

---

## Part 12 — Verify the whole stack

Run these from your Windows PC. All should succeed:

```bash
curl https://api.aiminfocom.com/health
```

Log in with the admin account you seeded:

```bash
curl -X POST https://api.aiminfocom.com/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"you@aiminfocom.com\",\"password\":\"YOUR_ADMIN_PASSWORD\"}"
```

You should get a JWT token back. Then confirm the things that must **not** work:

```bash
curl http://api.aiminfocom.com/health
```

This should redirect to HTTPS (301), not serve content directly.

```bash
telnet api.aiminfocom.com 3306
```

This must **fail to connect**. If it connects, MySQL is exposed — stop and fix
`bind-address` and `ufw` before going further.

---

## Part 13 — Point your apps at the new server ✅ code edits done

The source edits are already committed in the `Tally_sync` repo. Three files
pointed at Railway and now point at `api.aiminfocom.com`:

| File | Change |
| --- | --- |
| `mobile/.env.production` | `REACT_APP_API_URL`, `API_BASE_URL`, `WEBSOCKET_URL`, `TALLY_AGENT_URL` |
| `mobile/src/services/apiClient.ts` | `PRODUCTION_API_URL` hardcoded fallback |
| `desktop-agent/config/serverDefaults.js` | `PRODUCTION_SERVER.url` and `.apiUrl` |

The `apiClient.ts` fallback is the one that would have bitten you silently: it is
used whenever `@env` fails to inject `API_BASE_URL` at build time, so a build with
a broken `.env` would have quietly kept talking to Railway.

Two placeholder secrets were also deleted from `mobile/.env.production`
(`JWT_SECRET=production-jwt-secret-key`,
`ENCRYPTION_KEY=production-encryption-key`). Nothing in `mobile/src` ever read
them, so nothing breaks. Server secrets do not belong in a mobile bundle —
anything shipped in an APK can be extracted from it.

### What you still have to do: switch the env before building

`mobile/.env` is the file the build actually reads, and it is currently set to
**development** (`http://localhost:5000`). Building the release APK right now
would produce an app that talks to localhost. Switch it first:

```bash
cd mobile
node switch-environment.js production
```

Confirm the output lists `api.aiminfocom.com` URLs, then build the release APK.

### Then rebuild both clients

A fresh Android APK for your colleagues, and a fresh agent installer for the
Tally PCs. Already-installed copies keep talking to Railway until they are
updated — so keep Railway alive until every agent and phone is on the new build,
and do not split a customer across two backends.

### Before the Play Store submission

- Privacy policy URL is required. This ties into your DPDP work — the policy
  must name Aim Infocom Services Pvt. Ltd. as the data fiduciary.
- Data safety form: declare that you collect financial/accounting data and
  transmit it encrypted.
- Test the APK on a real device on mobile data (not just Wi-Fi) before handing
  it to colleagues.

---

## Part 14 — Database backups

Snapshots of the VPS are not enough. Set up nightly logical dumps.

Store the password in a root-only file so it never appears in a process list or
in cron logs:

```bash
sudo nano /root/.tallyfin-backup.cnf
```

Contents:

```ini
[client]
user=tallyfin
password=DB_PASSWORD
```

Lock it and create the backup directory:

```bash
sudo chmod 600 /root/.tallyfin-backup.cnf
sudo mkdir -p /var/backups/tallyfin
```

Create the backup script:

```bash
sudo nano /usr/local/bin/tallyfin-backup.sh
```

Contents:

```bash
#!/usr/bin/env bash
set -euo pipefail
DEST=/var/backups/tallyfin
STAMP=$(date +%F-%H%M)
mysqldump --defaults-extra-file=/root/.tallyfin-backup.cnf \
  --single-transaction --no-tablespaces --routines --events \
  tallyfin | gzip > "$DEST/tallyfin-$STAMP.sql.gz"
find "$DEST" -name 'tallyfin-*.sql.gz' -mtime +30 -delete
```

Make it executable and test it immediately — an untested backup is not a backup:

```bash
sudo chmod +x /usr/local/bin/tallyfin-backup.sh
sudo /usr/local/bin/tallyfin-backup.sh
ls -lh /var/backups/tallyfin
```

Schedule it at 2 AM daily:

```bash
sudo crontab -e
```

Add:

```cron
0 2 * * * /usr/local/bin/tallyfin-backup.sh >> /var/log/tallyfin-backup.log 2>&1
```

`--single-transaction` means the dump is consistent without locking tables, so
customers can keep using the app while it runs.

### Copy backups off the server

A backup that only exists on the machine that can fail is half a backup. Once a
week, from your Windows PC:

```bash
scp rizwan@187.127.164.88:/var/backups/tallyfin/*.sql.gz D:\Backups\tallyfin\
```

### Practice a restore

Do this once, now, while you have no customers:

```bash
gunzip -c /var/backups/tallyfin/tallyfin-XXXX.sql.gz | mysql -u tallyfin -p tallyfin
```

Knowing the restore command works is the entire point of having backups.

---

## Part 15 — Day-to-day operations

### Deploying a code update

```bash
cd /var/www/tallyfin
git pull
npm install --omit=dev
pm2 restart tallyfin-backend
pm2 logs tallyfin-backend --lines 40
```

Your `.env` is gitignored, so `git pull` never overwrites it. If a release adds a
new required variable you must add it by hand — check the release notes or diff
`.env.example`.

Take a manual backup first if the release touches the database:

```bash
sudo /usr/local/bin/tallyfin-backup.sh
```

### Schema changes

The backend calls `sequelize.sync()` with `alter: false` by default, so it
creates **new** tables but will not modify existing ones. When a release changes
a column, run once with alter enabled:

```bash
sudo /usr/local/bin/tallyfin-backup.sh   # back up FIRST, always
cd /var/www/tallyfin
MYSQL_SYNC_ALTER=true pm2 restart tallyfin-backend --update-env
pm2 logs tallyfin-backend --lines 40
pm2 restart tallyfin-backend --update-env   # back to alter:false
```

Never set `MYSQL_SYNC_FORCE=true` on this server — it **drops and recreates
every table**, destroying all customer data.

### Useful commands

| Purpose | Command |
| --- | --- |
| App status | `pm2 status` |
| Live logs | `pm2 logs tallyfin-backend` |
| Restart app | `pm2 restart tallyfin-backend` |
| App error log file | `tail -f /var/www/tallyfin/logs/app.log` |
| Nginx errors | `sudo tail -f /var/log/nginx/tallyfin.error.log` |
| Nginx access | `sudo tail -f /var/log/nginx/tallyfin.access.log` |
| MySQL status | `sudo systemctl status mysql` |
| Memory / swap | `free -h` |
| Disk space | `df -h` |
| Live resource use | `htop` (install with `sudo apt install htop`) |
| Who is connected to MySQL | `mysql -u tallyfin -p -e "SHOW PROCESSLIST;"` |

### Watch these as you onboard customers

On 1 vCPU / 4 GB, the two things that will bite first:

- **Disk** — Tally voucher history grows fast. Check `df -h` monthly. Trim the
  Winston logs if `logs/` balloons.
- **Memory** — `free -h`. If swap is consistently in use under normal load, it
  is time to move to KVM 2. Your `docs/` notes already flag that the WebSocket
  agent map lives in a single Node process, so **do not** scale by running
  multiple PM2 instances — that breaks agent routing. Scale up, not out, until
  Redis-backed sticky routing exists.

---

## Part 16 — Decommission the old hosting

Only after your colleagues have tested the new APK against the VPS for a few
days, and after the Tally desktop agent has completed a full sync:

1. Export anything you still need from MongoDB Atlas.
2. Confirm no client build still points at `web-production-577680.up.railway.app`
   (grep the repo).
3. Pause, then delete, the Railway service.
4. Delete the Atlas cluster.

Keeping them running costs money and, worse, means a stale client can silently
write to a database nobody is watching.

---

## Part 17 — Security checklist

Run through this before you give the app to a single paying customer:

- [ ] Root SSH login disabled, password auth disabled, key login working
- [ ] `sudo ufw status` shows only 22, 80, 443
- [ ] `telnet api.aiminfocom.com 3306` fails to connect
- [ ] `sudo ss -lntp | grep 3306` shows `127.0.0.1:3306`, not `0.0.0.0:3306`
- [ ] `.env` is `chmod 600` and contains no example placeholder secrets
- [ ] `JWT_SECRET` and `ENCRYPTION_KEY` are the generated random values
- [ ] `NODE_ENV=production`
- [ ] `SWAGGER_ENABLED=false`
- [ ] HTTPS works and HTTP redirects to it
- [ ] `sudo certbot renew --dry-run` passes
- [ ] Nightly backup cron installed **and a restore has been tested**
- [ ] Backups copied off the server at least weekly
- [ ] `fail2ban` active (`sudo systemctl status fail2ban`)
- [ ] No real secrets committed to git (your `.env.example` is already clean)
- [ ] Mobile `.env.production` no longer carries server secrets

---

## Part 18 — Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `502 Bad Gateway` | Node is down. `pm2 status`, then `pm2 logs tallyfin-backend`. |
| App exits right after start | MySQL credentials wrong. In production the backend exits on DB failure by design. Test with `mysql -u tallyfin -p`. |
| Error mentions database `finsync360` or user `finsync` | Your `.env` isn't being read. Those are the legacy fallback defaults in `src/config/database.js` used when `MYSQL_DATABASE`/`MYSQL_USER` are unset. Check the file exists at `/var/www/tallyfin/.env` and that PM2 was started from that directory. |
| Certbot fails with "challenge failed" | DNS not pointing at the VPS yet, or port 80 blocked. Check `nslookup` and `sudo ufw status`. Wait for DNS; do not retry in a loop — Let's Encrypt rate-limits. |
| Desktop agent connects then drops | Nginx not upgrading the WebSocket. Confirm you copied the current `deployment/nginx-tallyfin.conf` (it has the `/tally-agent` block) and reloaded Nginx. |
| Mobile app: "network request failed" | Almost always still pointing at the old Railway URL, or built before you edited `.env.production`. Rebuild the APK. |
| Android blocks the connection | You are using `http://` or an IP address. Must be `https://api.aiminfocom.com`. |
| `npm install` killed | Out of memory. Confirm swap: `free -h`. Re-run `bash hostinger-bootstrap.sh`. |
| Script fails with `$'\r': command not found` | Windows line endings survived the `scp`. Fix on the server: `sudo apt install -y dos2unix && dos2unix ~/hostinger-bootstrap.sh`. The repo's `.gitattributes` should prevent this. |
| MySQL won't start after reboot | Usually disk full. `df -h`, clear old backups/logs. |
| Locked out of SSH | Use the browser terminal in hPanel to fix `/etc/ssh/sshd_config`. |
| Tally sync slow | Expected on 1 vCPU with large voucher history. Uploads are serialized by design; check `pm2 logs` for 1006 close codes before assuming a server problem. |

---

## Cost summary

| Item | Rough cost |
| --- | --- |
| Hostinger VPS KVM 1 | as per your plan |
| Domain | you already have one |
| Let's Encrypt TLS | free |
| MySQL 8 | free |
| VPS snapshot add-on | optional, small |
| Google Play developer account | one-time $25 |

Replaces Railway + MongoDB Atlas entirely.
