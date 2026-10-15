#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04/24.04 VM (Oracle Cloud free tier, any VPS).
# Usage:  sudo bash deploy/setup-ubuntu.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash deploy/setup-ubuntu.sh"; exit 1; fi
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-ubuntu}"
WEB_PORT=3000
RELAY_PORT=19134

read -rp "Choose a password for the website (no spaces or quotes): " ADMIN_PASSWORD
[ -n "$ADMIN_PASSWORD" ] || { echo "Password can't be empty."; exit 1; }

echo "== Installing Node.js 20 and build tools =="
apt-get update -y
apt-get install -y curl ca-certificates build-essential cmake git python3
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "== Installing app dependencies =="
cd "$APP_DIR"
sudo -u "$RUN_USER" npm install --omit=dev

echo "== Opening ports on this machine's firewall =="
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow ${WEB_PORT}/tcp; ufw allow ${RELAY_PORT}/udp
fi
# Oracle Cloud Ubuntu images ship iptables rules that drop everything except SSH
iptables -C INPUT -p tcp --dport ${WEB_PORT} -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport ${WEB_PORT} -j ACCEPT
iptables -C INPUT -p udp --dport ${RELAY_PORT} -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport ${RELAY_PORT} -j ACCEPT
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save || true; else
  apt-get install -y iptables-persistent >/dev/null 2>&1 && netfilter-persistent save || true
fi

echo "== Creating the service (starts on boot, restarts if it crashes) =="
umask 077
cat > /etc/ghost-bridge.env <<ENV
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PORT=${WEB_PORT}
RELAY_PORT=${RELAY_PORT}
ENV
cat > /etc/systemd/system/ghost-bridge.service <<UNIT
[Unit]
Description=Ghost Bridge
After=network-online.target
Wants=network-online.target

[Service]
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/ghost-bridge.env
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ghost-bridge

IP="$(curl -fsS https://api.ipify.org 2>/dev/null || echo '<your-vm-ip>')"
echo
echo "Done. Open  http://${IP}:${WEB_PORT}  on your phone."
echo
echo "IMPORTANT: also open these in your cloud provider's firewall / security list:"
echo "   TCP ${WEB_PORT}  and  UDP ${RELAY_PORT}   (source 0.0.0.0/0)"
echo "Logs:  journalctl -u ghost-bridge -f"