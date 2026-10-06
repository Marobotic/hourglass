# Hourglass

Calendar, notes, alarms and timers in one app, built around one idea:
**the right notes at the right moment.** When a lecture is on, its notes are
already open.

Every AI on the machine can use it too: ask ChatGPT, Claude, Gemini or any
CLI to "add my Tuesday 8 AM lecture", "show the notes for this lecture" or
"set a 25 minute timer".

See [docs/DESIGN.md](docs/DESIGN.md) for the model, sync and UX rules.

## Layout

| Path | What | Status |
|---|---|---|
| `core/` | Shared rules in JS: dates, recurrence, "now", alarms, model. Plus the SQLite store and service used by server and Linux | 11 tests |
| `server/` | Node server: REST, sync, iCal feed, MCP endpoint, OpenAPI for Custom GPTs | 8 tests |
| `linux/` | QML app + Node sidecar (local replica, alarms, sync). Follows the Omarchy theme | Installed |
| `windows/` | Same QML app + Node sidecar. `app/`, `sidecar/`, `tools/` are byte-identical copies of the Linux ones | Builds |
| `android/` | Kotlin + Compose. Offline store, sync, exact alarms with a full-screen ring | Builds; 6 Kotlin core tests; Paparazzi screenshots in `app/src/test/snapshots` |
| `ios/` | SwiftUI, XcodeGen, built by GitHub Actions | Needs a CI run |
| `skill/hourglass/` | Agent skill: the model, the tools, examples | Linked for Claude, Codex, agents |
| `assets/` | Pixel hourglass icon (`make-icons.py`) | |

## Linux

```bash
linux/install.sh      # launcher, sidecar service, menu entry, icon
hourglass             # open the app
hourglass-cli now     # or any action: hourglass-cli add_note '{"course":"...","body":"..."}'
```

Keys: `1`-`4` switch screens, `n` note for the current session, `t` timers, `Esc` back.

The sidecar listens on `127.0.0.1:8931` (token in `~/.config/hourglass/token`)
and serves the same REST and MCP API as the server. Data lives in
`~/.local/share/hourglass/`. To sync with a server, write
`~/.config/hourglass/config.json`:

```json
{ "server": "https://example.com/hourglass", "token": "..." }
```

## Windows

```powershell
cd windows
# add node\node.exe and qt\qml.exe to this folder (or have node/qml on PATH)
.\Install.ps1       # Start menu entry, bin\ on PATH, service at sign-in
# then: hourglass / hourglass-cli now
```

Same keys, same sidecar port, same sync as Linux. The UI is the same QML
(`windows\app` is a byte-identical copy of `linux\app`), and alarms ring via
Windows notifications with `node:sqlite` storage handled by the sidecar.

## Server

```bash
cd server && npm ci
HOURGLASS_DATA=/var/lib/hourglass HOURGLASS_PORT=8930 node server.js
```

- `POST /mcp`: MCP, bearer token (stateless streamable HTTP)
- `POST /api/actions/<tool>`: the same tools as REST; `GET /openapi.json` for Custom GPT actions
- `GET/POST /api/sync`: replica sync (pull by rev, push dirty rows, last write wins, note conflict copies)
- `GET /ical?key=...`: subscribe from Google or Apple Calendar
- `GET/POST /api/assistant[/message|/stop|/new]`: the in-app Assistant tab

### Assistant

The Assistant tab lets anyone signed in ask Hourglass to do things ("tidy my
latest note", "wake me at 7:30 on weekdays"). The server hands the message to
[opencode](https://opencode.ai) running on the same machine; opencode works on
that account's data through the Hourglass MCP tools, with a key the server makes
for it, so no AI link is needed. Each account gets its own workspace whose config
switches off every built-in opencode tool (shell, files, web).

```bash
sudo bash server/assistant-setup.sh       # opencode as its own user, localhost only
sudo -u hourglass-ai HOME=/var/lib/hourglass-assistant/home opencode auth login
# then run the server with:
HOURGLASS_ASSISTANT_URL=http://127.0.0.1:4590 HOURGLASS_ASSISTANT_DIR=/var/lib/hourglass-assistant/workspaces HOURGLASS_ASSISTANT_MODEL=<provider/model> node server.js
```

opencode's free models refuse requests from `opencode serve`, so it needs a real
provider key.

## Android

```bash
cd android
JAVA_HOME=~/dev/tools/jdk-21 ./gradlew assembleRelease     # judge on release, not debug
~/Android/Sdk/platform-tools/adb install -r app/build/outputs/apk/release/app-release.apk
JAVA_HOME=~/dev/tools/jdk-21 ./gradlew recordPaparazziDebug # UI screenshots without a device
```

## iOS

Push to `main` and the `iOS` workflow builds an unsigned `Hourglass.ipa`;
sign and install it from Linux the same way as maro-ios. Alarms ring as
local notifications for now; AlarmKit (iOS 26) is the upgrade for real alarms.

## Tests

```bash
node --test core/test/ server/test/
cd android && JAVA_HOME=~/dev/tools/jdk-21 ./gradlew testReleaseUnitTest
```
