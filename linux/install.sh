#!/usr/bin/env bash
# Installs Hourglass for the current user: launcher, sidecar service, menu entry, icon.
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
NODE="$(command -v node)"
BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"
UNITS="$HOME/.config/systemd/user"
mkdir -p "$BIN" "$APPS" "$UNITS" "$ICONS/scalable/apps"

ln -sf "$ROOT/bin/hourglass" "$BIN/hourglass"
ln -sf "$ROOT/bin/hourglass-cli" "$BIN/hourglass-cli"
sed -e "s|@ROOT@|$ROOT|g" -e "s|@NODE@|$NODE|g" "$ROOT/share/hourglassd.service" > "$UNITS/hourglassd.service"
sed -e "s|@ROOT@|$ROOT|g" "$ROOT/share/hourglass.desktop" > "$APPS/hourglass.desktop"
cp "$ROOT/../assets/hourglass.svg" "$ICONS/scalable/apps/hourglass.svg"
for s in 256 128 64 48; do
  mkdir -p "$ICONS/${s}x${s}/apps"
  cp "$ROOT/../assets/icon-$s.png" "$ICONS/${s}x${s}/apps/hourglass.png"
done
gtk-update-icon-cache -q "$ICONS" 2>/dev/null || true
update-desktop-database -q "$APPS" 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable --now hourglassd.service
echo "Installed. Run 'hourglass' or pick Hourglass from the app menu."
echo "Local MCP endpoint: http://127.0.0.1:8931/mcp (token in ~/.config/hourglass/token)"
