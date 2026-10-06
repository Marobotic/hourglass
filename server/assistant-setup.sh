#!/usr/bin/env bash
# Sets up the server for the Hourglass assistant. Safe to run again.
#
#   sudo bash server/assistant-setup.sh
#
# Each message runs stock `opencode run` on opencode's free models, in its own
# throwaway systemd sandbox, as the unprivileged hourglass-ai user (see
# assistant.js). This creates that user and the folder the per-account
# sandboxes live in, and removes the always-on `opencode serve` an earlier
# version of the assistant used.
#
# Then start the Hourglass server with HOURGLASS_ASSISTANT=on.
set -euo pipefail

BASE=/var/lib/hourglass-assistant
DATA="${HOURGLASS_DATA:-/var/lib/hourglass}"
OPENCODE="$(command -v opencode)"

id hourglass-ai >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin hourglass-ai
# The Hourglass server (root) makes one folder per account here and hands it to hourglass-ai.
install -d -o root -g root -m 755 "$BASE"
install -d -o root -g root -m 711 "$BASE/accounts"

# The earlier design: a long-running opencode serve behind a password.
if systemctl list-unit-files hourglass-assistant.service >/dev/null 2>&1; then
  systemctl disable --now hourglass-assistant.service 2>/dev/null || true
  rm -f /etc/systemd/system/hourglass-assistant.service
  systemctl daemon-reload
fi
rm -f /etc/hourglass-assistant.env "$DATA/assistant_password"
rm -rf "$BASE/workspaces" "$BASE/home"

echo "Ready. Start Hourglass with HOURGLASS_ASSISTANT=on HOURGLASS_ASSISTANT_BIN=$OPENCODE"
