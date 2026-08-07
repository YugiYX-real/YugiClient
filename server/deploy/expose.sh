#!/usr/bin/env bash
# Makes the Halcyon backend answer on the public ip of this machine instead of loopback only.
# Run as root from the repository root:
#   sudo bash server/deploy/expose.sh
set -euo pipefail

ENV_FILE=/etc/halcyon-backend.env
SCHEME=http

if [[ $EUID -ne 0 ]]; then
	echo "Run this script as root." >&2
	exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
	echo "$ENV_FILE is missing. Run server/deploy/install.sh first." >&2
	exit 1
fi

read_value() {
	local line
	line="$(grep -E "^${1}=" "$ENV_FILE" | tail -n 1 || true)"
	echo "${line#*=}"
}

set_value() {
	if grep -qE "^${1}=" "$ENV_FILE"; then
		sed -i "s|^${1}=.*|${1}=${2}|" "$ENV_FILE"
	else
		echo "${1}=${2}" >>"$ENV_FILE"
	fi
}

PORT="$(read_value PORT)"
PORT="${PORT:-8787}"

echo "Binding the backend to every interface on port ${PORT}"
set_value HOST 0.0.0.0

# Reachable from the whole internet means the heartbeat needs a shared secret,
# otherwise anyone can add names to the roster.
CLIENT_KEY="$(read_value CLIENT_KEY)"
if [[ -z "$CLIENT_KEY" ]]; then
	CLIENT_KEY="$(openssl rand -hex 24)"
	set_value CLIENT_KEY "$CLIENT_KEY"
	echo "Generated a client key so strangers cannot write to the roster"
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "^Status: active"; then
	echo "Opening port ${PORT} in ufw"
	ufw allow "${PORT}/tcp" >/dev/null
fi

systemctl restart halcyon-backend
sleep 1
systemctl --no-pager status halcyon-backend | head -n 6

PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
if [[ -z "$PUBLIC_IP" ]]; then
	PUBLIC_IP="$(hostname -I | awk '{print $1}')"
fi

echo
echo "Local check:"
curl -fsS "${SCHEME}://127.0.0.1:${PORT}/v1/health" && echo

echo
echo "Backend url: ${SCHEME}://${PUBLIC_IP}:${PORT}"
echo "Client key:  ${CLIENT_KEY}"
echo
echo "Put both into config/halcyon-companion.json inside the instance:"
echo "  \"backendUrl\": \"${SCHEME}://${PUBLIC_IP}:${PORT}\","
echo "  \"backendKey\": \"${CLIENT_KEY}\""
