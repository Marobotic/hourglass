# Hourglass for Windows, built on this PC: the same steps as
# .github/workflows/windows.yml, so a change can be tried on Windows without
# waiting for GitHub. Releases still come from the workflow.
#
#   .\tools\build-windows-local.ps1                  # HEAD, clean tree
#   .\tools\build-windows-local.ps1 -Dirty           # include uncommitted changes
#   .\tools\build-windows-local.ps1 -Node 24         # use CI's Node, not this PC's
#   .\tools\build-windows-local.ps1 -NoSmokeTest     # skip starting the app offscreen
#
# The package is assembled from `git archive`, never from the working tree, so
# no local data, tokens or untracked files can get into it. The installer is
# named Hourglass-<version>-dev-setup.exe and goes to
# Documents\Project Exports\Hourglass\Windows, so it is never taken for a
# release build.
param(
  [switch]$Dirty,
  [switch]$NoSmokeTest,
  [string]$QtRoot = '',
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

  # --- Qt: 6.8.3 msvc2022_64 with qtmultimedia, as install-qt-action gets it ---
  $qt = ''
  foreach ($c in @($QtRoot, $env:QT_ROOT_DIR, 'C:\Qt\6.8.3\msvc2022_64', (Join-Path $root 'windows\qt'))) {
    if (-not $c -or -not (Test-Path $c)) { continue }
    if (-not (Test-Path (Join-Path $c 'bin\qml.exe'))) { continue }
    if (-not (Test-Path (Join-Path $c 'bin\windeployqt.exe'))) {
      Write-Host "  $c has qml.exe but no bin\windeployqt.exe (a deployed runtime, not the Qt SDK)"
      continue
    }
    if (-not (Test-Path (Join-Path $c 'plugins\multimedia'))) {
      Write-Host "  $c has no plugins\multimedia: add the qtmultimedia module"
      continue
    }
    $qt = $c
    break
  }
  if (-not $qt) {
    throw @"
Qt 6.8.3 msvc2022_64 with qtmultimedia not found (looked at -QtRoot, QT_ROOT_DIR,
C:\Qt\6.8.3\msvc2022_64 and windows\qt in the repo). Install it with:

  python -m pip install --user aqtinstall
  python -m aqt install-qt windows desktop 6.8.3 win64_msvc2022_64 -m qtmultimedia -O C:\Qt

or pass -QtRoot <folder> pointing at a 6.8.3 msvc2022_64 tree.
"@
  }
  $qtVersion = ''
  if (Test-Path (Join-Path $qt 'bin\qmake.exe')) { $qtVersion = (& (Join-Path $qt 'bin\qmake.exe') -query QT_VERSION).Trim() }
  Write-Host "Qt $qtVersion ($qt)"
  if ($qtVersion -and $qtVersion -ne '6.8.3') { Write-Host "  note: CI uses 6.8.3" }

  # --- assemble the package exactly where the workflow puts it -------------
  # dist\Hourglass mirrors the repo, so the app finds its parts by the same
  # relative paths: windows\sidecar imports ..\..\core, the window is
  # windows\qt\bin\Hourglass.exe.
  $d = Join-Path $src 'dist\Hourglass'
  $w = Join-Path $d 'windows'
  New-Item -ItemType Directory -Force (Join-Path $w 'node'), (Join-Path $w 'qt\bin'), (Join-Path $w 'app\fonts') | Out-Null
  Push-Location (Join-Path $src 'server')
  try {
    & npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  } finally { Pop-Location }
  Copy-Item (Join-Path $src 'core') (Join-Path $d 'core') -Recurse
  Copy-Item (Join-Path $src 'server') (Join-Path $d 'server') -Recurse
  Copy-Item (Join-Path $src 'assets') (Join-Path $d 'assets') -Recurse
  Remove-Item (Join-Path $d 'core\test'), (Join-Path $d 'server\test') -Recurse -Force
  foreach ($x in 'app', 'sidecar', 'bin', 'share', 'tools') { Copy-Item (Join-Path $src "windows\$x") $w -Recurse -Force }
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

  # --- Qt runtime: qml.exe plus what it needs, and the media backend -------
  Copy-Item (Join-Path $qt 'bin\qml.exe') (Join-Path $w 'qt\bin')
  Push-Location $src
  try {
    & (Join-Path $qt 'bin\windeployqt.exe') --qmldir windows\app --release --no-translations --no-system-d3d-compiler (Join-Path $w 'qt\bin\qml.exe')
    if ($LASTEXITCODE -ne 0) { throw 'windeployqt failed' }
  } finally { Pop-Location }
  # windeployqt leaves out the media backend: without it Drive cannot play audio or video.
  New-Item -ItemType Directory -Force (Join-Path $w 'qt\bin\multimedia') | Out-Null
  Copy-Item (Join-Path $qt 'plugins\multimedia\*.dll') (Join-Path $w 'qt\bin\multimedia')
  # FFmpeg, which the multimedia plugin needs.
  $ffmpeg = @(Get-ChildItem (Join-Path $qt 'bin\av*.dll'), (Join-Path $qt 'bin\sw*.dll') -ErrorAction SilentlyContinue)
  if (-not $ffmpeg) { Write-Host '  note: no av*.dll / sw*.dll in Qt bin (audio and video will not play)' }
  else { $ffmpeg | Copy-Item -Destination (Join-Path $w 'qt\bin') }
  Step 'windeployqt + multimedia'

  # --- icons: a full Nerd Font -------------------------------------------
  $jbm = Fetch 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip' 'JetBrainsMono.zip'
  Expand-Archive -Path $jbm -DestinationPath (Join-Path $work 'jbm') -Force
  Copy-Item (Join-Path $work 'jbm\JetBrainsMonoNerdFont-Regular.ttf'), (Join-Path $work 'jbm\JetBrainsMonoNerdFont-Bold.ttf') (Join-Path $w 'app\fonts')
  Step 'fonts'

  # --- Hourglass.exe / hourglassd.exe: named copies, so Task Manager says Hourglass
  & (Join-Path $w 'tools\brand.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'brand.ps1 failed' }
  if (-not (Test-Path (Join-Path $w 'qt\bin\Hourglass.exe')) -or -not (Test-Path (Join-Path $w 'node\hourglassd.exe'))) { throw 'branding failed' }
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
      $t = (Get-Content (Join-Path $env:HOURGLASS_CONFIG 'token') -Raw).Trim()
      # windeployqt ships only platforms\qwindows.dll (the release package has
      # nothing else to render with), so the offscreen platform comes from the
      # Qt SDK, and offscreen is what keeps a window off the screen.
      $env:QT_PLUGIN_PATH = Join-Path $qt 'plugins'
      $env:QT_QPA_PLATFORM = 'offscreen'
      $env:QT_FATAL_WARNINGS = '0'
      $env:QT_QUICK_CONTROLS_STYLE = 'Basic'
      $env:QT_FORCE_STDERR_LOGGING = '1'
      Push-Location $work
      try {
        foreach ($page in 0, 1) {
          $q = Start-Process -PassThru -NoNewWindow (Join-Path $w 'qt\bin\Hourglass.exe') -ArgumentList @('-I', ('"{0}"' -f (Join-Path $w 'app')), ('"{0}"' -f (Join-Path $w 'app\Main.qml')), '--', '--port', '8941', '--token', $t, '--page', $page, '--screenshot', "shot-$page.png", '--size', '1300x820')
          if (-not $q.WaitForExit(60000)) { $q.Kill(); throw "page $page did not exit" }
          if (-not (Test-Path "shot-$page.png")) { throw "page $page did not render" }
        }
      } finally { Pop-Location }
    } finally { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
    Step 'smoke test (2 pages offscreen)'
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
  # -dev in the version, so the installer says dev in Add/Remove too.
  & $iscc "/DAppVersion=${version}-dev" "/DPackage=$d" (Join-Path $src 'windows\installer\Hourglass.iss')
  if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
  $exe = Get-ChildItem (Join-Path $src 'dist\Hourglass-*-dev-setup.exe') | Select-Object -First 1
  if (-not $exe) { throw 'the installer was not written' }
  Step 'ISCC'

  New-Item -ItemType Directory -Force $OutDir | Out-Null
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
