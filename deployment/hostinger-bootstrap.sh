#!/usr/bin/env bash
# Hostinger VPS bootstrap for the TallyFin backend.
#
# Target: Ubuntu 24.04 LTS (plain OS image), Hostinger KVM 1 or larger.
# Run as a non-root sudo user, from the repo root:
#   bash deployment/hostinger-bootstrap.sh
#
# Safe to re-run: every step is idempotent.
#
# Installs: MySQL 8, Node 20 LTS, Nginx, Certbot, PM2, ufw, fail2ban.
# Does NOT create the database, write .env, or start the app -- see
# docs/HOSTINGER_VPS_PRODUCTION_GUIDE.md for those steps.
set -euo pipefail

NODE_MAJOR=20
APP_DIR=/var/www/tallyfin

echo "==> Set timezone to Asia/Kolkata"
sudo timedatectl set-timezone Asia/Kolkata

echo "==> Updating package lists"
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y

echo "==> Installing base packages"
sudo DEBIAN_FRONTEND=noninteractive apt install -y \
  mysql-server nginx certbot python3-certbot-nginx \
  git curl ufw fail2ban unattended-upgrades

echo "==> Installing Node ${NODE_MAJOR} LTS"
if ! command -v node >/dev/null 2>&1 || \
   [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt install -y nodejs
fi
node -v
npm -v

echo "==> Installing PM2"
sudo npm install -g pm2

# KVM 1 has 1 vCPU / 4 GB RAM. `npm install` builds native modules (sharp, bcryptjs)
# and can spike past available memory. Swap prevents the OOM killer from
# terminating mysqld mid-install.
echo "==> Ensuring 2 GB swap exists"
if ! sudo swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '^/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  # Prefer RAM; only swap under real pressure.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-tallyfin-swap.conf >/dev/null
  sudo sysctl -p /etc/sysctl.d/99-tallyfin-swap.conf
fi
free -h

echo "==> Binding MySQL to localhost only (port 3306 must never be public)"
MYSQL_CNF=/etc/mysql/mysql.conf.d/mysqld.cnf
if [ -f "$MYSQL_CNF" ]; then
  if grep -qE '^\s*bind-address' "$MYSQL_CNF"; then
    sudo sed -i 's/^\s*bind-address.*/bind-address = 127.0.0.1/' "$MYSQL_CNF"
  else
    echo 'bind-address = 127.0.0.1' | sudo tee -a "$MYSQL_CNF" >/dev/null
  fi
  sudo systemctl enable mysql
  sudo systemctl restart mysql
fi
sudo ss -lntp | grep 3306 || true

echo "==> Configuring firewall (SSH + HTTP + HTTPS only)"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose

echo "==> Enabling fail2ban (blocks SSH brute-force)"
sudo systemctl enable --now fail2ban

echo "==> Enabling automatic security updates"
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Creating app directory at ${APP_DIR}"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"

cat <<'EOF'

============================================================
Bootstrap complete. Remaining steps (full detail in
docs/HOSTINGER_VPS_PRODUCTION_GUIDE.md):

  1. sudo mysql_secure_installation
  2. Create the tallyfin database + tallyfin@localhost user
  3. git clone the backend repo into /var/www/tallyfin
  4. cd /var/www/tallyfin
     cp .env.example .env   # then set MYSQL_*, JWT_SECRET,
                            # ENCRYPTION_KEY, ADMIN_*, FRONTEND_URL
  5. npm install --omit=dev
  6. node scripts/create-single-admin.js
  7. pm2 start src/server.js --name tallyfin-backend --time
     pm2 save && pm2 startup   # run the sudo line it prints
  8. Install deployment/nginx-tallyfin.conf, set your domain,
     then: sudo certbot --nginx -d api.YOURDOMAIN.com
  9. Point desktop-agent + mobile production URLs at
     https://api.YOURDOMAIN.com
 10. Install the nightly mysqldump cron job
============================================================
EOF
