# Hostinger VPS deployment (Phase 2 — after local MySQL sync works)

Suggested VPS: Ubuntu 22.04, 2–4 GB RAM.  
Stack: MySQL 8 Community + Node 18 + Nginx + Certbot + PM2.

**Do not expose MySQL port 3306.** Bind to `127.0.0.1` only.

## Quick path

1. Buy Hostinger VPS (Ubuntu 22.04).
2. SSH in and run:
   ```bash
   bash deployment/hostinger-bootstrap.sh
   ```
3. Clone this repo to `/var/www/finsync360`.
4. Create MySQL database/user (see section below).
5. Configure `backend/.env` (`MYSQL_*`, `JWT_*`, your `ADMIN_*`).
6. `cd backend && npm ci --omit=dev && node scripts/create-single-admin.js`
7. `pm2 start src/server.js --name finsync-backend && pm2 save && pm2 startup`
8. Install Nginx site from [`deployment/nginx-finsync360.conf`](../deployment/nginx-finsync360.conf) (replace `api.YOURDOMAIN.com`), then Certbot.
9. Point clients:
   - [`desktop-agent/config/serverDefaults.js`](../desktop-agent/config/serverDefaults.js) production URLs → your domain
   - [`mobile/.env.production`](../mobile/.env.production) → `https://api.YOURDOMAIN.com/api`
10. Rebuild agent installer + mobile release; smoke-test; shut down Railway + Atlas.

## MySQL (localhost only)

```sql
CREATE DATABASE finsync360 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'finsync'@'localhost' IDENTIFIED BY 'STRONG_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON finsync360.* TO 'finsync'@'localhost';
FLUSH PRIVILEGES;
```

Edit `/etc/mysql/mysql.conf.d/mysqld.cnf`: `bind-address = 127.0.0.1`  
`sudo systemctl restart mysql`

## Nginx + TLS

Use [`deployment/nginx-finsync360.conf`](../deployment/nginx-finsync360.conf). WebSocket upgrade headers are required for `/tally-agent`.

```bash
sudo certbot --nginx -d api.YOURDOMAIN.com
```

## Backups

```cron
0 2 * * * mysqldump -u finsync -p'PASSWORD' finsync360 | gzip > /var/backups/finsync360-$(date +\%F).sql.gz
```

## Notes

- Single Node/PM2 process for agent WebSocket map (no multi-instance without Redis sticky routing).
- Seed admin only with your own `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
