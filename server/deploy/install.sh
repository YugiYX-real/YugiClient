#!/usr/bin/env bash
# Installs the Halcyon backend on Ubuntu 24.04. Run as root from the repository root:
#   sudo bash server/deploy/install.sh
set -euo pipefail

APP_DIR=/opt/halcyon-backend
DATA_DIR=/var/lib/halcyon-backend
ENV_FILE=/etc/halcyon-backend.env
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
	echo "Run this script as root." >&2
	exit 1
fi

if ! command -v node >/dev/null 2>&1; then
	echo "Installing Node.js 22 from Nodesource"
	apt-get update
	apt-get install -y ca-certificates curl gnupg
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y nodejs
fi

if ! id halcyon >/dev/null 2>&1; then
	echo "Creating the halcyon service user"
	useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin halcyon
fi

echo "Installing the application to $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$SOURCE_DIR/src" "$SOURCE_DIR/package.json" "$APP_DIR/"

mkdir -p "$DATA_DIR"
chown -R halcyon:halcyon "$DATA_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Writing $ENV_FILE with a generated admin token"
	cp "$SOURCE_DIR/.env.example" "$ENV_FILE"
	ADMIN_TOKEN="$(openssl rand -hex 32)"
	sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=${ADMIN_TOKEN}|" "$ENV_FILE"
	chmod 600 "$ENV_FILE"
	echo "Admin token: ${ADMIN_TOKEN}"
fi

echo "Installing the systemd unit"
cp "$SOURCE_DIR/deploy/halcyon-backend.service" /etc/systemd/system/halcyon-backend.service
systemctl daemon-reload
systemctl enable --now halcyon-backend

echo
systemctl --no-pager status halcyon-backend | head -n 12
echo
echo "Done. Check it with: curl http://127.0.0.1:8787/v1/health"
