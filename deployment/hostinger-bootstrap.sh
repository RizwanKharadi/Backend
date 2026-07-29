#!/usr/bin/env bash
# Hostinger VPS bootstrap (run on Ubuntu 22.04 as a sudo user after purchase)
# Usage: bash deployment/hostinger-bootstrap.sh
set -euo pipefail

echo "==> Installing packages"
sudo apt update
sudo apt install -y mysql-server nginx certbot python3-certbot-nginx git curl
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

echo "==> Harden MySQL bind address (localhost only)"
MYSQL_CNF=/etc/mysql/mysql.conf.d/mysqld.cnf
if [ -f "$MYSQL_CNF" ]; then
  sudo sed -i 's/^bind-address.*/bind-address = 127.0.0.1/' "$MYSQL_CNF" || true
  sudo systemctl restart mysql
fi

echo "==> Create app directory"
sudo mkdir -p /var/www/finsync360
sudo chown "$USER:$USER" /var/www/finsync360

echo ""
echo "Next manual steps:"
echo "  1. Clone repo into /var/www/finsync360"
echo "  2. Create MySQL DB/user (see docs/HOSTINGER_VPS_MYSQL_DEPLOY.md)"
echo "  3. cd /var/www/finsync360/backend && cp .env.example .env && edit MYSQL_* JWT_* ADMIN_*"
echo "  4. npm ci --omit=dev && node scripts/create-single-admin.js"
echo "  5. pm2 start src/server.js --name finsync-backend && pm2 save && pm2 startup"
echo "  6. Copy deployment/nginx-finsync360.conf → sites-available, set domain, certbot"
echo "  7. Point desktop-agent + mobile production URLs at https://api.YOURDOMAIN.com"
echo "  8. Decommission Railway + Atlas"
