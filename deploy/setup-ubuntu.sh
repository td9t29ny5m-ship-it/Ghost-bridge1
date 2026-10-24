#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04/24.04 VPS.
# Usage: sudo bash deploy/setup-ubuntu.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash deploy/setup-ubuntu.sh"
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-ubuntu}"
WEB_PORT=3000
RELAY_PORT=19134

read -rsp "Choose a strong dashboard password (input hidden): " ADMIN_PASSWORD
echo
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "Password can't be empty."
  exit 1
fi

echo "== Installing Node.js 24 and build tools =="
apt-get update
apt-get install -y curl ca-certificates build-essential cmake pkg-config python3 git
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "== Installing application dependencies =="
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"

echo "== Opening ports in UFW if it is enabled =="
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$WEB_PORT/tcp"
  ufw allow "$RELAY_PORT/udp"
fi

echo "== Creating systemd service =="
umask 077
cat > /etc/ghost-bridge.env <<EOF
ADMIN_PASSWORD=$ADMIN_PASSWORD
PORT=$WEB_PORT
DATA_DIR=$APP_DIR/data
RELAY_PORT=$RELAY_PORT
EOF
unset ADMIN_PASSWORD

cat > /etc/systemd/system/ghost-bridge.service <<EOF
[Unit]
Description=Ghost Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/ghost-bridge.env
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ghost-bridge
IP="$(curl -fsS https://api.ipify.org 2>/dev/null || echo '<your-vps-ip>')"
echo
echo "Ghost Bridge started."
echo "Dashboard: http://$IP:$WEB_PORT"
echo "Logs: journalctl -u ghost-bridge -f"
echo "IMPORTANT: also allow TCP $WEB_PORT and UDP $RELAY_PORT in your VPS/cloud firewall."
echo "Set RELAY_PUBLIC_HOST and RELAY_PUBLIC_PORT in /etc/ghost-bridge.env only when a real public UDP endpoint forwards to the relay."
