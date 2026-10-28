# Hourglass launcher for Windows: starts the background service if needed,
# then has it open the window (the service is the window's parent). Layout of the package:
#   node\node.exe  qt\qml.exe  app\Main.qml  sidecar\hourglassd.js
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$conf = Join-Path $env:APPDATA 'Hourglass'
$port = if ($env:HOURGLASS_PORT) { [int]$env:HOURGLASS_PORT } else { 8931 }
$node = Join-Path $root 'node\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
# Hourglass.exe is qml.exe with Hourglass's name and icon (tools\brand.ps1), so
# Task Manager says Hourglass rather than QML Runtime.
$qml = Join-Path $root 'qt\bin\Hourglass.exe'
if (-not (Test-Path $qml)) { $qml = Join-Path $root 'qt\bin\qml.exe' }
if (-not (Test-Path $qml)) { $qml = Join-Path $root 'qt\qml.exe' }
if (-not (Test-Path $qml)) { $qml = (Get-Command qml -ErrorAction Stop).Source }

function Test-Up {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$port/health").StatusCode -eq 200 } catch { $false }
}

New-Item -ItemType Directory -Force -Path $conf | Out-Null
# First run: take the sync settings that came with the package.
if (-not (Test-Path "$conf\config.json") -and (Test-Path "$root\config.json")) {
  Copy-Item "$root\config.json" "$conf\config.json"
}
# The service moves the token into DPAPI on start; do not leave a plain copy behind.
if (Test-Path "$root\config.json") { Remove-Item "$root\config.json" -Force }

if (-not (Test-Up)) {
  & wscript.exe "$root\bin\hourglassd.vbs"
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 200 }
}
if (-not (Test-Up)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('The Hourglass service did not start.', 'Hourglass') | Out-Null
  exit 1
}

$token = (Get-Content "$conf\token" -Raw).Trim()
$env:QT_QUICK_CONTROLS_STYLE = 'Basic'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HgWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
# The service owns the window (one Hourglass in Task Manager): ask it to open
# the window, or bring it back from the tray. A window that is already showing
# is brought to the front here, straight away.
$open = @(Get-Process Hourglass, qml -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Hourglass' }) | Select-Object -First 1
if ($open) {
  [HgWindow]::ShowWindow($open.MainWindowHandle, 9) | Out-Null
  [HgWindow]::SetForegroundWindow($open.MainWindowHandle) | Out-Null
}
$asked = $false
$oldService = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/window/show" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 8 | Out-Null
    $asked = $true
    break
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    if ($status -eq 404) {
      $oldService = $true
      break
    }
    if ($status) { break }
    if ($attempt -lt 3) { Start-Sleep -Seconds 1 }
  }
}
if ($oldService -and -not $open) {
  # An older service without /api/window: start the window ourselves.
  Start-Process -FilePath $qml -ArgumentList @('--apptype', 'widget', '-platform', 'windows:menus=native', '-I', "`"$root\app`"", "`"$root\app\Main.qml`"", '--', '--port', $port, '--token', $token) -WindowStyle Normal
} elseif (-not $asked) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('The Hourglass service is running but could not open its window. Try again in a moment.', 'Hourglass') | Out-Null
}
