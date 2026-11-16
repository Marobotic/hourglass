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

# The window (0.3): the Tauri app in desktop/, built here when Rust and Node are installed.
if command -v cargo >/dev/null && command -v npm >/dev/null; then
  ( cd "$ROOT/../desktop" && npm ci --no-audit --no-fund && node build.mjs && cargo build --release --manifest-path src-tauri/Cargo.toml )
  TARGET="$(cd "$ROOT/../desktop/src-tauri" && cargo metadata --format-version 1 --no-deps | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).target_directory))')"
  mkdir -p "$ROOT/window"
  install -m 755 "$TARGET/release/hourglass" "$ROOT/window/hourglass"
else
  echo "Rust (cargo) or Node (npm) is missing: the older Qt window opens until Hourglass is installed again with both."
fi

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
