Hourglass for Windows
=====================

1. Unzip this folder somewhere permanent, e.g. C:\Users\<you>\Hourglass
2. Right-click Install.ps1 > Run with PowerShell (adds a Start menu entry,
   puts bin\ on your PATH, and starts the background service at sign-in, so
   alarms ring with the window closed)
3. Open Hourglass from the Start menu, or double-click Hourglass.vbs

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
