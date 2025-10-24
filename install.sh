#!/usr/bin/env bash
set -euo pipefail

# ---- config ----
SERVICE=docker-deploy
BIN=/usr/local/bin/$SERVICE
UNIT=/etc/systemd/system/$SERVICE.service
DATA_DIR=/var/lib/$SERVICE
ENV_DIR=/etc/$SERVICE
ENV_FILE=$ENV_DIR/.env
USER=${SUDO_USER:-$(whoami)}   # try to avoid running as root user

# ---- helpers ----
have() { command -v "$1" >/dev/null 2>&1; }
script_dir() { cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd; }

# ---- arch detect (kept your mapping) ----
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) PKG_ARCH=amd64 ;;
  aarch64|arm64) PKG_ARCH=arm64 ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

# ---- Docker install (added) ----
install_docker() {
  if have docker; then
    echo "✔ Docker already installed: $(docker --version 2>/dev/null || true)"
    return
  fi

  echo "→ Installing Docker..."
  if have curl && curl -fsSL https://get.docker.com >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  else
    # fallback by distro
    if have apt-get; then
      sudo apt-get update -y
      sudo apt-get install -y docker.io || sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || true
    elif have dnf; then
      sudo dnf install -y docker docker-compose-plugin || sudo dnf install -y moby-engine moby-compose || true
    elif have yum; then
      sudo yum install -y docker docker-compose-plugin || sudo yum install -y docker-ce docker-ce-cli containerd.io || true
    elif have zypper; then
      sudo zypper refresh
      sudo zypper install -y docker
    elif have pacman; then
      sudo pacman -Syu --noconfirm docker
    elif have apk; then
      sudo apk update
      sudo apk add docker
    else
      echo "❌ No supported package manager detected. Please install Docker manually."
      exit 1
    fi
  fi
  echo "✔ Docker installed."
}

enable_start_docker() {
  if have systemctl; then
    sudo systemctl enable --now docker
  elif have rc-update && have rc-service; then
    sudo rc-update add docker default
    sudo rc-service docker start
  elif have service; then
    sudo service docker start || true
  else
    echo "⚠ Could not detect init system to auto-start Docker. Start it manually if needed."
  fi
}

add_user_to_docker_group() {
  if ! getent group docker >/dev/null 2>&1; then
    sudo groupadd docker || true
  fi
  if [ "$USER" != "root" ]; then
    sudo usermod -aG docker "$USER" || true
    echo "ℹ Added ${USER} to 'docker' group. You may need to log out/in for it to take effect."
  fi
}

# ---- install your binary (kept your layout + robust path) ----
SRC_DIR="$(script_dir)"
SRC_BIN="${SRC_DIR}/bin/${SERVICE}-linux-${PKG_ARCH}"
if [ ! -f "$SRC_BIN" ]; then
  echo "❌ Binary not found: $SRC_BIN"
  echo "   Ensure your compiled binary is at bin/${SERVICE}-linux-${PKG_ARCH} next to install.sh"
  exit 1
fi

cp "$SRC_BIN" /tmp/$SERVICE
sudo install -m 0755 /tmp/$SERVICE "$BIN"

# ---- dirs (kept your dirs) ----
sudo mkdir -p "$DATA_DIR" "$ENV_DIR"
sudo chown -R "$USER:$USER" "$DATA_DIR"

# ---- systemd unit (your content, unchanged semantics) ----
sudo tee "$UNIT" >/dev/null <<'EOF'
[Unit]
Description=Docker deploy agent
After=network-online.target docker.service
Wants=network-online.target docker.service

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
ProtectHome=false
EnvironmentFile=-/etc/REPLACE_ME_BIN/.env

[Install]
WantedBy=multi-user.target
EOF

sudo sed -i "s/REPLACE_ME_USER/$USER/g" "$UNIT"
sudo sed -i "s/REPLACE_ME_BIN/$SERVICE/g" "$UNIT"

# ---- secret prompt (kept ACCESS_TOKEN + 600 perms) ----
echo "Service has been installed."
echo "Now you are required to setup an access password that you will use for communication."

while true; do
  read -rsp "Enter password: " PASS; echo
  read -rsp "Confirm password: " PASS2; echo
  if [ -z "$PASS" ]; then
    echo "Password cannot be empty."
  elif [ "$PASS" != "$PASS2" ]; then
    echo "Passwords do not match. Try again."
  else
    break
  fi
done

# shell-escape the value so special chars are safe in KEY=VALUE format
printf 'ACCESS_TOKEN=%q\n' "$PASS" | sudo tee "$ENV_FILE" >/dev/null
sudo chmod 600 "$ENV_FILE"
unset PASS PASS2

# ---- start services (added docker enable; kept your service start) ----
install_docker
enable_start_docker
add_user_to_docker_group

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE}.service"

echo "Installed and started $SERVICE"
echo "Docker  : $(docker --version 2>/dev/null || echo 'installed')"
echo "Status  : sudo systemctl status $SERVICE"
echo "Logs    : journalctl -u $SERVICE -f"
