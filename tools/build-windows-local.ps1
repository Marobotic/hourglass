# Hourglass for Windows, built on marolaptop: the same steps as
# .github/workflows/windows.yml, so a change can be tried on Windows without
# waiting for GitHub. Releases still come from the workflow.
#
#   .\tools\build-windows-local.ps1                  # HEAD, clean tree
#   .\tools\build-windows-local.ps1 -Dirty           # include uncommitted changes
#   .\tools\build-windows-local.ps1 -Node 24         # use CI's Node, not this PC's
#   .\tools\build-windows-local.ps1 -NoSmokeTest     # skip starting the service on a throwaway profile
#
# The package is assembled from `git archive`, never from the working tree, so
# no local data, tokens or untracked files can get into it. The installer is
# the normal Hourglass-<version>-setup.exe (bump server/app.js VERSION first) and
# goes to Documents\Project Exports\Hourglass\Windows, replacing the older ones.
param(
  [switch]$Dirty,
  [switch]$NoSmokeTest,
  [string]$Node = '',
  [string]$OutDir = '',
  [switch]$KeepWork
)
$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
$step = [Diagnostics.Stopwatch]::StartNew()
function Step($name) {
  Write-Host ('  {0,-34} {1,6:n1}s' -f $name, $step.Elapsed.TotalSeconds)
  $step.Restart()
}

# --- where ----------------------------------------------------------------
$root = (& git -C (Split-Path -Parent $PSScriptRoot) rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $root) { throw 'Not inside the hourglass git checkout.' }
$root = $root.Trim()
if (-not (Test-Path (Join-Path $root '.github\workflows\windows.yml'))) { throw "$root is not the hourglass repo." }
if (-not $OutDir) { $OutDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Project Exports\Hourglass\Windows' }
Write-Host "Hourglass local Windows build  ($root)"

# --- which code -----------------------------------------------------------
$changes = @(& git -C $root status --porcelain)
if ($changes.Count -and -not $Dirty) {
  Write-Host ($changes -join "`n")
  throw 'Uncommitted changes: commit them, or pass -Dirty to build them anyway.'
}
$ref = 'HEAD'
if ($Dirty) {
  # stash create writes a commit for the working tree without pushing anything
  # onto the stash stack, so other sessions' stashes are untouched.
  $wip = (& git -C $root stash create) | Out-String
  $wip = $wip.Trim()
  if ($wip) { $ref = $wip; Write-Host "Building uncommitted changes ($wip)" }
  else { Write-Host 'Nothing tracked to include: building HEAD' }
  $untracked = @(& git -C $root ls-files --others --exclude-standard)
  if ($untracked.Count) { Write-Host "  (untracked files are not packaged: $($untracked.Count))" }
}
$commit = (& git -C $root rev-parse --short $ref).Trim()
Write-Host "Building $commit"

$work = Join-Path $env:TEMP ("hourglass-local-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$src = Join-Path $work 'src'
New-Item -ItemType Directory -Force $work, $src | Out-Null
try {
  $zip = Join-Path $work 'src.zip'
  & git -C $root archive --format=zip --output=$zip $ref
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
  Expand-Archive -Path $zip -DestinationPath $src -Force
  Step 'git archive + extract'

  $found = Select-String -Path (Join-Path $src 'server\app.js') -Pattern 'VERSION = "([^"]+)"' | Select-Object -First 1
  $version = if ($found) { $found.Matches[0].Groups[1].Value } else { '' }
  if (-not $version) { throw 'no VERSION in server/app.js' }
  Write-Host "Hourglass $version"

  # --- the window: Tauri 2 (desktop\), built here; no Qt any more (0.3) ---
  Push-Location (Join-Path $src 'desktop')
  try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'desktop npm ci failed' }
    & node build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'desktop UI build failed' }
    & cargo build --release --manifest-path src-tauri\Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'desktop cargo build failed' }
  } finally { Pop-Location }
  # Wherever cargo really put it: a shared target folder (CARGO_TARGET_DIR or ~/.cargo/config.toml) wins.
  $tauriTarget = ((& cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $src 'desktop\src-tauri\Cargo.toml')) | ConvertFrom-Json).target_directory
  Step 'window (Tauri, cargo)'

  # --- assemble the package exactly where the workflow puts it -------------
  # dist\Hourglass mirrors the repo, so the app finds its parts by the same
  # relative paths: windows\sidecar imports ..\..\core, the window is
  # windows\window\Hourglass.exe.
  $d = Join-Path $src 'dist\Hourglass'
  $w = Join-Path $d 'windows'
  New-Item -ItemType Directory -Force (Join-Path $w 'node'), (Join-Path $w 'window') | Out-Null
  Copy-Item (Join-Path $tauriTarget 'release\hourglass.exe') (Join-Path $w 'window\Hourglass.exe') -Force
  Push-Location $src
  try {
    & cargo build --manifest-path windows\shell\hourglass-shell\Cargo.toml --release
    if ($LASTEXITCODE -ne 0) { throw 'hourglass-shell cargo build failed' }
  } finally { Pop-Location }
  New-Item -ItemType Directory -Force (Join-Path $w 'bin') | Out-Null
  # A shared CARGO_TARGET_DIR (this PC has one) puts the exe there, not beside the crate.
  $shellTarget = ((& cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $src 'windows\shell\hourglass-shell\Cargo.toml')) | ConvertFrom-Json).target_directory
  Copy-Item (Join-Path $shellTarget 'release\hourglass-shell.exe') (Join-Path $w 'bin\hourglass-shell.exe') -Force
  Step 'Cloud Files helper (cargo)'
  Push-Location (Join-Path $src 'server')
  try {
    & npm.cmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  } finally { Pop-Location }
  Copy-Item (Join-Path $src 'core') (Join-Path $d 'core') -Recurse
  Copy-Item (Join-Path $src 'server') (Join-Path $d 'server') -Recurse
  Copy-Item (Join-Path $src 'assets') (Join-Path $d 'assets') -Recurse
  Remove-Item (Join-Path $d 'core\test'), (Join-Path $d 'server\test') -Recurse -Force
  foreach ($x in 'sidecar', 'bin', 'share', 'tools') { Copy-Item (Join-Path $src "windows\$x") $w -Recurse -Force }
  foreach ($f in 'Hourglass.ps1', 'Hourglass.vbs', 'Install.ps1', 'hourglass.ico', 'README.txt') { Copy-Item (Join-Path $src "windows\$f") $w }
  Step 'npm ci + copy core/server/assets/windows'

  # --- Node runtime --------------------------------------------------------
  # Node and the font are the same file every build: kept between builds, which
  # is the difference between a minute and fifteen on a slow connection.
  $cache = Join-Path $env:LOCALAPPDATA 'hourglass-build-cache'
  New-Item -ItemType Directory -Force $cache | Out-Null
  function Fetch($url, $name) {
    $f = Join-Path $cache $name
    if (-not (Test-Path $f)) { Invoke-WebRequest -UseBasicParsing $url -OutFile $f }
    return $f
  }
  if ($Node -match '^\d+$') {
    # CI's Node: the version the workflow's setup-node step installs.
    $nodeExe = Fetch "https://nodejs.org/dist/latest-v$Node.x/win-x64/node.exe" "node-v$Node.exe"
  } else {
    $nodeExe = if ($Node) { $Node } else { (Get-Command node).Source }
    if (-not (Test-Path $nodeExe)) { throw "node.exe not found: $nodeExe" }
  }
  Copy-Item $nodeExe (Join-Path $w 'node\node.exe') -Force
  Write-Host ('Node {0}' -f ((& (Join-Path $w 'node\node.exe') --version).Trim()))
  Step 'Node runtime'

  # --- hourglassd.exe: a named copy of node, so Task Manager says Hourglass (the window is already Hourglass.exe)
  & (Join-Path $w 'tools\brand.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'brand.ps1 failed' }
  if (-not (Test-Path (Join-Path $w 'window\Hourglass.exe')) -or -not (Test-Path (Join-Path $w 'node\hourglassd.exe'))) { throw 'the package has no window or service' }
  Step 'brand'

  # --- smoke test: start the service on a throwaway profile and render the
  # app offscreen, so a broken package fails here rather than on the PC ---
  if (-not $NoSmokeTest) {
    $env:HOURGLASS_CONFIG = Join-Path $work 'conf'
    $env:HOURGLASS_DATA = Join-Path $work 'data'
    $env:HOURGLASS_PORT = '8941'
    $env:HOURGLASS_SILENT = '1'
    $env:HOURGLASS_UPDATE_FEED = 'off'
    $p = Start-Process -PassThru -NoNewWindow (Join-Path $w 'node\hourglassd.exe') -ArgumentList ('"{0}"' -f (Join-Path $w 'sidecar\hourglassd.js'))
    try {
      $up = $false
      for ($i = 0; $i -lt 50; $i++) {
        try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8941/health' -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep -Milliseconds 300 }
      }
      if (-not $up) { throw 'the service did not answer on 8941' }
      # The window is a web page now: the service must answer the window's own origin (CORS).
      $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8941/api/app' -Method Options -Headers @{ Origin = 'http://tauri.localhost'; 'Access-Control-Request-Method' = 'GET'; 'Access-Control-Request-Headers' = 'authorization' } -TimeoutSec 5
      if ($r.Headers['Access-Control-Allow-Origin'] -ne 'http://tauri.localhost') { throw 'the service does not let the window in (CORS)' }
    } finally { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
    Step 'smoke test (service + window origin)'
  }

  # --- Inno Setup ----------------------------------------------------------
  $iscc = @(
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6\ISCC.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $iscc) {
    Write-Host 'Inno Setup not found: installing it with winget...'
    winget install --id JRSoftware.InnoSetup -e --silent --accept-package-agreements --accept-source-agreements
    $iscc = @(
      (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6\ISCC.exe'),
      (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Inno Setup 6\ISCC.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $iscc) { throw 'ISCC.exe not found after installing Inno Setup' }
  }
  & $iscc "/DAppVersion=$version" "/DPackage=$d" (Join-Path $src 'windows\installer\Hourglass.iss')
  if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
  $exe = Get-ChildItem (Join-Path $src 'dist\Hourglass-*-setup.exe') | Select-Object -First 1
  if (-not $exe) { throw 'the installer was not written' }
  Step 'ISCC'

  New-Item -ItemType Directory -Force $OutDir | Out-Null
  # Only the newest installer stays (and the uninstaller, if there is one).
  Get-ChildItem $OutDir -Filter 'Hourglass-*-setup.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $exe.Name } | Remove-Item -Force
  $out = Join-Path $OutDir $exe.Name
  Copy-Item $exe.FullName $out -Force
} finally {
  if (-not $KeepWork) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
  elseif ($work) { Write-Host "Kept $work" }
}

$size = (Get-Item $out).Length / 1MB
Write-Host ''
Write-Host ('{0}  ({1:n0} MB, {2}, built {3:n0} min {4:n0} s)' -f $out, $size, $commit, [math]::Floor($sw.Elapsed.TotalMinutes), $sw.Elapsed.Seconds)
Write-Host ('sha256 {0}' -f (Get-FileHash $out -Algorithm SHA256).Hash.ToLower())
