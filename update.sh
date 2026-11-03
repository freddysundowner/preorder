#!/usr/bin/env bash
# Quick update on the server after you push changes to GitHub.
# Run from the project folder:   sudo bash update.sh
# Pulls the latest code, installs dependencies only if they changed, rebuilds the web app and restarts the API.
# Database migrations run automatically when the API starts. It does not touch nginx, SSL, Postgres or server/.env.
set -euo pipefail

SERVICE="${SERVICE:-preorder}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash update.sh"; exit 1; }
[ -d .git ] || { echo "This folder is not a git clone. Clone the repo on the server, or use deploy.sh."; exit 1; }

say "Pulling latest code"
before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"
if [ "$before" = "$after" ]; then
  echo "    Already up to date ($(git rev-parse --short HEAD))."
else
  echo "    $(git rev-parse --short "$before") -> $(git rev-parse --short "$after")"
  git --no-pager log --oneline "$before..$after"
fi

changed() { [ "$before" != "$after" ] && git diff --name-only "$before" "$after" | grep -q "$1"; }

if changed '^server/package'; then say "Installing API dependencies"; (cd server && npm install --omit=dev --no-audit --no-fund); fi
if changed '^web/'; then
  say "Rebuilding web app"
  (cd web && npm install --no-audit --no-fund && npm run build)
fi

say "Restarting API"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" && echo "    $SERVICE is running" || { journalctl -u "$SERVICE" -n 30 --no-pager; exit 1; }
journalctl -u "$SERVICE" -n 5 --no-pager | grep -i "migration" || true

say "Done"
echo "    Logs: journalctl -u $SERVICE -f"
