#!/usr/bin/env bash
# Deploys the preorder system to https://preorder.reggycodas.com on an Ubuntu/Debian server.
# Run it ON THE SERVER, from the project folder, as root:   sudo bash deploy.sh
# Safe to re-run: it checks what is already installed and only does what is missing.
#   - Postgres already installed  -> not reinstalled, only the database/user are created if missing
#   - SSL cert already issued     -> not requested again
#   - server/.env already exists  -> kept as is
set -euo pipefail

DOMAIN="${DOMAIN:-preorder.reggycodas.com}"
LE_EMAIL="${LE_EMAIL:-reggycodas@gmail.com}"
DB_NAME="${DB_NAME:-preorder}"
DB_USER="${DB_USER:-preorder}"
APP_USER="${APP_USER:-www-data}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="preorder"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash deploy.sh"; exit 1; }
[ -f "$APP_DIR/server/package.json" ] || { echo "Run this from the project folder (server/ and web/ must be next to deploy.sh)"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
APT_UPDATED=0
apt_install() {
  if [ "$APT_UPDATED" -eq 0 ]; then apt-get update -qq; APT_UPDATED=1; fi
  apt-get install -y -qq "$@"
}

# ---------------------------------------------------------------- DNS
say "Checking DNS for $DOMAIN"
SERVER_IP="$(curl -4fsS https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -z "$DNS_IP" ]; then
  warn "$DOMAIN does not resolve yet. Add an A record: preorder -> ${SERVER_IP:-YOUR_SERVER_IP}"
  DNS_OK=0
elif [ -n "$SERVER_IP" ] && [ "$DNS_IP" != "$SERVER_IP" ]; then
  warn "$DOMAIN points to $DNS_IP but this server is $SERVER_IP. Fix the A record."
  DNS_OK=0
else
  ok "$DOMAIN -> $DNS_IP"
  DNS_OK=1
fi

# ---------------------------------------------------------------- Node
say "Node.js"
if have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  ok "Node $(node -v) already installed"
else
  apt_install ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt_install nodejs
  ok "Installed Node $(node -v)"
fi

# ---------------------------------------------------------------- PostgreSQL
say "PostgreSQL"
if have psql && { systemctl list-unit-files 2>/dev/null | grep -q '^postgresql'; } ; then
  ok "PostgreSQL already installed ($(psql --version)); not reinstalling"
else
  apt_install postgresql postgresql-contrib
  ok "Installed PostgreSQL"
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
for _ in $(seq 1 15); do su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 && break; sleep 1; done
su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 || { echo "PostgreSQL is not accepting connections"; exit 1; }

ENV_FILE="$APP_DIR/server/.env"
DB_PASS=""
role_exists="$(su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='$DB_USER'\"")"
if [ "$role_exists" != "1" ]; then
  DB_PASS="$(openssl rand -hex 16)"
  su postgres -c "psql -c \"create role $DB_USER login password '$DB_PASS'\"" >/dev/null
  ok "Created database user $DB_USER"
else
  ok "Database user $DB_USER already exists"
fi
db_exists="$(su postgres -c "psql -tAc \"select 1 from pg_database where datname='$DB_NAME'\"")"
if [ "$db_exists" != "1" ]; then
  su postgres -c "createdb -O $DB_USER $DB_NAME"
  ok "Created database $DB_NAME"
else
  ok "Database $DB_NAME already exists"
fi

# ---------------------------------------------------------------- App config
say "App configuration"
if [ -f "$ENV_FILE" ]; then
  ok "server/.env already exists; leaving it alone"
  [ -n "$DB_PASS" ] && warn "A new DB user was created with a new password; update DATABASE_URL in server/.env to use it: $DB_PASS"
else
  [ -n "$DB_PASS" ] || { echo "server/.env is missing but DB user $DB_USER already existed, so I don't know its password. Create server/.env yourself (see .env.example) and re-run."; exit 1; }
  cp "$APP_DIR/server/.env.example" "$ENV_FILE"
  setenv() { sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; }
  setenv DATABASE_URL "postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
  setenv JWT_SECRET "$(openssl rand -hex 32)"
  setenv MPESA_CALLBACK_SECRET "$(openssl rand -hex 16)"
  setenv WEB_ORIGIN "https://$DOMAIN"
  setenv PUBLIC_API_URL "https://$DOMAIN"
  chmod 600 "$ENV_FILE"
  ok "Wrote server/.env (secrets generated). Set ADMIN_PHONE, SMS and M-Pesa values in it before going live."
fi

# ---------------------------------------------------------------- Build
say "Installing dependencies and building"
(cd "$APP_DIR/server" && npm install --omit=dev --no-audit --no-fund)
(cd "$APP_DIR/web" && npm install --no-audit --no-fund && npm run build)
mkdir -p "$APP_DIR/server/uploads"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/server/uploads"
chmod o+rx "$(dirname "$APP_DIR")" 2>/dev/null || true
chown "root:$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

say "Running migrations and creating the admin account"
(cd "$APP_DIR/server" && npm run migrate --silent && npm run seed --silent)

# ---------------------------------------------------------------- systemd
say "API service"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Preorder system API
After=network.target postgresql.service

[Service]
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v node) src/index.js
Restart=always
User=$APP_USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" && ok "$SERVICE service running" || { journalctl -u "$SERVICE" -n 30 --no-pager; exit 1; }

# ---------------------------------------------------------------- nginx + SSL
say "nginx"
have nginx || apt_install nginx
SITE="/etc/nginx/sites-available/$DOMAIN"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)"; PORT="${PORT:-4000}"
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

write_site() {
  if [ -f "$CERT" ]; then
cat > "$SITE" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     $CERT;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  else
cat > "$SITE" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  fi
  ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  nginx -t && systemctl reload nginx
}
write_site
ok "nginx site for $DOMAIN configured"

say "SSL certificate"
if [ -f "$CERT" ]; then
  ok "Certificate for $DOMAIN already installed; not requesting a new one"
  expiry="$(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)"
  ok "Expires: $expiry"
elif [ "$DNS_OK" -ne 1 ]; then
  warn "Skipping SSL: DNS for $DOMAIN isn't pointing at this server yet. Fix DNS, then re-run this script."
else
  have certbot || apt_install certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect
  ok "Certificate issued"
fi
systemctl list-timers 2>/dev/null | grep -q certbot && ok "Auto-renewal timer active" || warn "No certbot renewal timer found; check 'certbot renew --dry-run'"

# ---------------------------------------------------------------- Done
say "Done"
curl -fsS -o /dev/null -w "    local API check: HTTP %{http_code}\n" "http://127.0.0.1:$PORT/" || warn "API did not answer locally"
echo "    Site:  https://$DOMAIN"
echo "    Logs:  journalctl -u $SERVICE -f"
echo "    Next:  edit server/.env (ADMIN_PHONE, SMS_PROVIDER, MPESA_*), then: systemctl restart $SERVICE"
