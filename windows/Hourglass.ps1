# Hourglass launcher for Windows: starts the background service if needed,
# then opens the window. Layout of the package:
#   node\node.exe  qt\qml.exe  linux\app\Main.qml  linux\sidecar\hourglassd.js
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$conf = Join-Path $env:APPDATA 'Hourglass'
$port = 8931

function Test-Up {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$port/health").StatusCode -eq 200 } catch { $false }
}

New-Item -ItemType Directory -Force -Path $conf | Out-Null
# First run: take the sync settings that came with the package.
if (-not (Test-Path "$conf\config.json") -and (Test-Path "$root\config.json")) {
  Copy-Item "$root\config.json" "$conf\config.json"
}

if (-not (Test-Up)) {
  Start-Process -WindowStyle Hidden -FilePath "$root\node\node.exe" -ArgumentList "`"$root\linux\sidecar\hourglassd.js`""
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 200 }
}
if (-not (Test-Up)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('The Hourglass service did not start.', 'Hourglass') | Out-Null
  exit 1
}

$token = (Get-Content "$conf\token" -Raw).Trim()
$env:QT_QUICK_CONTROLS_STYLE = 'Basic'
Start-Process -FilePath "$root\qt\qml.exe" -ArgumentList @('-I', "`"$root\linux\app`"", "`"$root\linux\app\Main.qml`"", '--', '--port', "$port", '--token', $token) -WindowStyle Normal
