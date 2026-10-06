# Hourglass launcher for Windows: starts the background service if needed,
# then opens the window. Layout of the package:
#   node\node.exe  qt\qml.exe  app\Main.qml  sidecar\hourglassd.js
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$conf = Join-Path $env:APPDATA 'Hourglass'
$port = 8931
$node = Join-Path $root 'node\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$qml = Join-Path $root 'qt\bin\qml.exe'
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
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr LoadImageW(IntPtr hInst, string lpszName, uint type, int cx, int cy, uint fuLoad);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  // Qt Quick windows show Qt's own tile unless an icon is set; the
  // package ships hourglass.ico, so put it on the window (title bar
  // and taskbar) as soon as it exists.
  public static void SetIcon(IntPtr hwnd, string path) {
    const uint WM_SETICON = 0x80;
    const uint LR_LOADFROMFILE = 0x00000010;
    IntPtr small = LoadImageW(IntPtr.Zero, path, 1, 16, 16, LR_LOADFROMFILE);
    IntPtr big = LoadImageW(IntPtr.Zero, path, 1, 32, 32, LR_LOADFROMFILE);
    SendMessageW(hwnd, WM_SETICON, (IntPtr)0, small);
    SendMessageW(hwnd, WM_SETICON, (IntPtr)1, big);
  }
}
'@
$running = @(Get-Process qml -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Hourglass' }) | Select-Object -First 1
if ($running) {
  [HgWindow]::ShowWindow($running.MainWindowHandle, 9) | Out-Null
  [HgWindow]::SetForegroundWindow($running.MainWindowHandle) | Out-Null
  # an already-open window may predate the icon: set it here too
  [HgWindow]::SetIcon($running.MainWindowHandle, "$root\hourglass.ico")
  exit 0
}

Start-Process -FilePath $qml -ArgumentList @('-I', "`"$root\app`"", "`"$root\app\Main.qml`"", '--', '--port', $port, '--token', $token) -WindowStyle Normal

# Wait for the window, then set the hourglass icon on it. Qt applies
# its own tile as the window is realized, so re-apply for a while.
$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 50 -and $hwnd -eq [IntPtr]::Zero; $i++) {
  Start-Sleep -Milliseconds 200
  $p = @(Get-Process qml -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Hourglass' }) | Select-Object -First 1
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle }
}
if ($hwnd -ne [IntPtr]::Zero) {
  [HgWindow]::SetIcon($hwnd, "$root\hourglass.ico")
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $p = Get-Process qml -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Hourglass' } | Select-Object -First 1
    if (-not $p) { break }
    [HgWindow]::SetIcon($p.MainWindowHandle, "$root\hourglass.ico")
  }
}
