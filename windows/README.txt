Hourglass for Windows
=====================

Install: run Hourglass-<version>-setup.exe from https://marobotic.dev. It installs
for you only (no admin prompt) into %LOCALAPPDATA%\Programs\Hourglass, adds a
Start menu entry, and starts the background service at sign-in so alarms ring
with the window closed. Hourglass tells you when a new version is out and
installs it with one click.

From a folder instead (a checkout or the CI zip): right-click Install.ps1 >
Run with PowerShell, then open Hourglass from the Start menu.

Your data syncs with marobotic.dev, the same as the Linux app and the phones.
Settings live in %APPDATA%\Hourglass, data in %LOCALAPPDATA%\Hourglass.
Keys: 1-4 switch screens, n new note for the current session, Esc back.

Layout (app\, sidecar\ and tools\ mirror their linux\ counterparts; two small
QML fixes: a refresh guard in Main.qml, and the launcher arguments read
in Api.qml so the first requests carry the token):

  app\        QML UI (Main.qml + Hourglass\)
  sidecar\    background service (hourglassd.js)
  bin\        hourglass / hourglass-cli
  share\      hourglass-service.ps1 (Windows stand-in for the systemd unit)
  tools\      demo-seed.mjs
  node\node.exe, qt\bin\qml.exe  bundled with the app; node/qml on PATH is
                             used as a fallback. qml.exe is a copy patched so
                             it opens without a console window and shows the
                             Hourglass icon.
