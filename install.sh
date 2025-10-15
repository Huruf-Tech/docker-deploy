#!/usr/bin/env bash
set -euo pipefail

SERVICE=docker-deploy
BIN=/usr/local/bin/$SERVICE
UNIT=/etc/systemd/system/$SERVICE.service
USER=${SUDO_USER:-$(whoami)}   # try to avoid running as root user

# detect arch
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) PKG_ARCH=amd64 ;;
  aarch64|arm64) PKG_ARCH=arm64 ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

# download the binary (adjust URL to your GitHub release)
# curl -L "https://github.com/you/your-repo/releases/latest/download/${SERVICE}-linux-${PKG_ARCH}" -o /tmp/$SERVICE
# For local dev/demo, just use the checked-out binary:
cp ./$SERVICE-linux-${PKG_ARCH} /tmp/$SERVICE

sudo install -m 0755 /tmp/$SERVICE "$BIN"
sudo mkdir -p /var/lib/$SERVICE /etc/$SERVICE
sudo chown -R "$USER:$USER" /var/lib/$SERVICE

# write unit (same as above; inline here for script simplicity)
sudo tee "$UNIT" >/dev/null <<'EOF'
[Unit]
Description=Your Binary Service
After=network-online.target
Wants=network-online.target

[Service]
User=REPLACE_ME_USER
Group=REPLACE_ME_USER
WorkingDirectory=/var/lib/REPLACE_ME_BIN
ExecStart=/usr/local/bin/REPLACE_ME_BIN
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

sudo sed -i "s/REPLACE_ME_USER/$USER/g" "$UNIT"
sudo sed -i "s/REPLACE_ME_BIN/$SERVICE/g" "$UNIT"

sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE

echo "Installed and started $SERVICE"
