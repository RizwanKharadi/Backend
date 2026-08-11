# Hostinger VPS deployment — quick reference

> **New to VPS hosting? Use the full walkthrough instead:**
> [`docs/HOSTINGER_VPS_PRODUCTION_GUIDE.md`](HOSTINGER_VPS_PRODUCTION_GUIDE.md)
> It covers ordering the VPS, DNS, SSH from Windows, backups, and troubleshooting.
>
> This page is the condensed checklist for when you already know the steps.

VPS: Hostinger KVM 1 or larger, **Ubuntu 24.04 LTS plain OS image**.
Stack: MySQL 8 + Node 20 LTS + Nginx + Certbot + PM2.

**Do not expose MySQL port 3306.** Bind to `127.0.0.1` only.

## Quick path

1. Order the VPS (plain Ubuntu 24.04, Mumbai datacenter).
2. Add DNS `A` record: `api` → `VPS_IP`. Verify with `nslookup` before Certbot.
3. Create a non-root sudo user, add your SSH key, disable root + password login.
4. Clone the standalone backend repo (`RizwanKharadi/Backend` — its root **is** the
   backend, no `backend/` subfolder) to `/var/www/tallyfin`. The `deployment/`
   files are not in that repo, so `scp` them from the main repo, then:
   ```bash
   bash ~/hostinger-bootstrap.sh
   ```
5. `sudo mysql_secure_installation`, then create the database/user (below).
6. In `/var/www/tallyfin`: `cp .env.example .env` and set `MYSQL_*`,
   `JWT_SECRET`, `ENCRYPTION_KEY`, `DESKTOP_AGENT_API_KEY`, `ADMIN_*`,
   `NODE_ENV=production`, `SWAGGER_ENABLED=false`. Then `chmod 600 .env`.
7. `npm install --omit=dev && node scripts/create-single-admin.js`
   (the seed script also creates the schema via `sequelize.sync()`).
8. `pm2 start src/server.js --name tallyfin-backend --time && pm2 save && pm2 startup`
9. Install [`deployment/nginx-tallyfin.conf`](../deployment/nginx-tallyfin.conf)
   (replace `api.YOURDOMAIN.com`), `nginx -t`, reload, then
   `sudo certbot --nginx -d api.YOURDOMAIN.com`.
10. Point clients at the new host (**already done** for `api.aiminfocom.com`):
    - [`desktop-agent/config/serverDefaults.js`](../desktop-agent/config/serverDefaults.js)
      `PRODUCTION_SERVER`
    - [`mobile/.env.production`](../mobile/.env.production)
    - [`mobile/src/services/apiClient.ts`](../mobile/src/services/apiClient.ts)
      `PRODUCTION_API_URL` — easy to miss, it's the fallback used when `@env`
      injection fails
    - Then run `node switch-environment.js production` in `mobile/` before
      building the release APK — `mobile/.env` is the file the build reads.
11. Install the nightly `mysqldump` cron, **test a restore**, rebuild the agent
    installer + mobile release, smoke-test, then shut down Railway + Atlas.

## MySQL (localhost only)

```sql
CREATE DATABASE tallyfin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tallyfin'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON tallyfin.* TO 'tallyfin'@'localhost';
FLUSH PRIVILEGES;
```

`/etc/mysql/mysql.conf.d/mysqld.cnf` → `bind-address = 127.0.0.1`, then
`sudo systemctl restart mysql`. Confirm with `sudo ss -lntp | grep 3306`.

## Nginx + TLS

Use [`deployment/nginx-tallyfin.conf`](../deployment/nginx-tallyfin.conf). It
proxies `/tally-agent` (desktop-agent WebSocket) and `/socket.io/` (mobile
realtime) with 24-hour timeouts, and normal REST traffic with 120s timeouts.

```bash
sudo certbot --nginx -d api.YOURDOMAIN.com
sudo certbot renew --dry-run
```

## Backups

Password in a root-only defaults file, not on the command line:

```cron
0 2 * * * /usr/local/bin/tallyfin-backup.sh >> /var/log/tallyfin-backup.log 2>&1
```

See the full guide for the script (uses `--single-transaction --no-tablespaces`
and 30-day retention).

## Notes

- Single Node/PM2 process only — the agent WebSocket map is in-process, so
  multiple instances break agent routing without Redis sticky routing. Scale up
  the VPS, not out.
- Seed admin only with your own `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- `MYSQL_SYNC_ALTER=true` only for a one-off schema migration, after a backup.
  **Never** `MYSQL_SYNC_FORCE=true` in production — it drops every table.
