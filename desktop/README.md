# Hourglass desktop window

Tauri 2 (Rust, `src-tauri/`) around a plain HTML/JS UI (`ui/`, ES modules bundled by esbuild into `dist/`). One app
for Windows and Linux. It is only the window: the Node service (`windows|linux/sidecar/hourglassd.js`) owns the data,
alarms and sync, and starts the window with `--port` and `--token`. Started on its own, the window reads the token
file and starts the service if it isn't up. The service also starts it with `--hidden` as soon as it is up, and
the Start menu runs this exe, so opening Hourglass shows a window that is already loaded (single instance).
Design: `docs/REDESIGN.md`.

## Build

Builds and tests run on the laptop (marolaptop), never on the PC.

```powershell
npm ci
node build.mjs                                              # ui/ -> dist/
cargo build --release --manifest-path src-tauri\Cargo.toml  # the exe (shared target folder)
```

`tools\build-windows-local.ps1` (repo root) puts it in `windows\window\Hourglass.exe` and builds the installer.

## Look at it without the window

```powershell
node build.mjs
node ui/dev/serve.mjs                                  # prints a URL: the real service, demo week, throwaway data
node ui/dev/serve.mjs --shot C:\build\shots\s.png --page now,schedule,notes --size 1440x900
node ui/dev/serve.mjs --shot s.png --page now --query "open=event"      # open=note|event|course|session|palette|new
node ui/dev/serve.mjs --shot s.png --page assistant --query "fakechat=1"
```

## Layout

| | |
|---|---|
| `ui/app.js` | boot, shared state, sidebar, router, keys, palette, ring / reminders / sign-in |
| `ui/kit.js`, `ui/dom.js` | controls, sheets, menus, toasts; the element builder and icons |
| `ui/pages/*.js` | one module per page: `mount(root, ctx, arg)` returns `{ update, unmount, escape }` |
| `ui/chat/` | Metro's markdown renderer and status words, the assistant's event stream |
| `ui/editor.js` | the note editor over `noteformat.mjs` (a byte-identical copy of core/noteformat.js) |
| `ui/css/` | tokens, kit, motion, shell, pages, notes, drive, chat |
