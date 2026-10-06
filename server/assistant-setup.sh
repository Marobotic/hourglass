#!/usr/bin/env bash
# Sets up opencode for the Hourglass assistant on the server. Safe to run again.
#
#   sudo bash server/assistant-setup.sh
#
# opencode runs as its own system user, on localhost only, behind a password the
# Hourglass server reads from <data>/assistant_password. It can only write in
# /var/lib/hourglass-assistant. Each account's workspace there allows nothing but
# the Hourglass MCP tools (see assistant.js).
#
# Afterwards, give opencode a model provider as that user, then tell Hourglass:
#   sudo -u hourglass-ai HOME=/var/lib/hourglass-assistant/home opencode auth login
#   HOURGLASS_ASSISTANT_MODEL=<provider/model> in the Hourglass server's environment
set -euo pipefail

PORT="${ASSISTANT_PORT:-4590}"
BASE=/var/lib/hourglass-assistant
DATA="${HOURGLASS_DATA:-/var/lib/hourglass}"
OPENCODE="$(command -v opencode)"

id hourglass-ai >/dev/null 2>&1 || useradd --system --home-dir "$BASE/home" --shell /usr/sbin/nologin hourglass-ai
install -d -o hourglass-ai -g hourglass-ai -m 700 "$BASE/home" "$BASE/home/.config" "$BASE/home/.config/opencode"
# Workspaces: written by the Hourglass server (root), read and used by opencode (the group).
install -d -o root -g hourglass-ai -m 2770 "$BASE/workspaces"

# Nothing global to pick up: no auto-update, no sharing.
cat > "$BASE/home/.config/opencode/opencode.json" <<JSON
{ "\$schema": "https://opencode.ai/config.json", "autoupdate": false, "share": "disabled" }
JSON
chown hourglass-ai:hourglass-ai "$BASE/home/.config/opencode/opencode.json"

PW="$DATA/assistant_password"
if [ ! -s "$PW" ]; then (umask 077; head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > "$PW"); fi
(umask 077; printf 'OPENCODE_SERVER_PASSWORD=%s\n' "$(cat "$PW")" > /etc/hourglass-assistant.env)

cat > /etc/systemd/system/hourglass-assistant.service <<UNIT
[Unit]
Description=opencode for the Hourglass assistant
After=network-online.target

[Service]
User=hourglass-ai
Group=hourglass-ai
Environment=HOME=$BASE/home
EnvironmentFile=/etc/hourglass-assistant.env
WorkingDirectory=$BASE/workspaces
ExecStart=$OPENCODE serve --hostname 127.0.0.1 --port $PORT
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$BASE

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now hourglass-assistant
systemctl restart hourglass-assistant
echo "opencode for Hourglass on 127.0.0.1:$PORT"
echo "Hourglass server env: HOURGLASS_ASSISTANT_URL=http://127.0.0.1:$PORT HOURGLASS_ASSISTANT_DIR=$BASE/workspaces HOURGLASS_ASSISTANT_MODEL=<provider/model>"
