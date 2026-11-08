<#
  Publishes a new Hourglass to marobotic.dev, where the apps look for updates.

    .\tools\release.ps1 -Version 0.2.1 -Notes "Drive keeps only the files you open."
    .\tools\release.ps1 -Version 0.2.1 -Notes "..." -DryRun     # build everything, upload nothing
    .\tools\release.ps1 -Version 0.2.2 -Notes "..." -ExportTo "C:\Users\Maro\Documents\Project Exports\Hourglass"
                                                       # build it for real, keep it in a folder, publish nothing

  1. Bumps the version (server/app.js, Android versionName/versionCode, iOS
     MARKETING_VERSION/CURRENT_PROJECT_VERSION), commits as Marobotic, pushes main.
     That push makes GitHub Actions build the Windows setup.exe and the iOS .ipa.
  2. Builds the Android APK (signed with the release key) and the Linux bundle on
     Maro's laptop, never here: the source is tarred over ssh to <LaptopDir>, built
     there, and the APK and bundle come back. The laptop folder is deleted after.
     -Laptop, -LaptopKey and -LaptopDir change where that build runs.
  3. Waits for the two CI runs and downloads their builds.
  4. Uploads it all to /var/www/marobotic.dev/apps/hourglass/<version>/ on the server and
     writes latest.json (what the apps read) and the SideStore source last, so an app
     never sees a version whose files are not there yet.
  5. Puts each build in Documents\Project Exports\Hourglass\<Platform>, and sends the
     versions it replaces to the Recycle Bin.

  Needs: git, gh (signed in), ssh/scp, a clean main branch, and the laptop reachable
  with the release key in C:\Users\Maro\.marobotic\keys (that is where the APK is
  signed; the signing values are never read from, or copied out of, this PC).
#>
param(
  [Parameter(Mandatory)] [string]$Version,
  [Parameter(Mandatory)] [string]$Notes,
  [switch]$DryRun,
  # A real version (committed, built by CI) saved to <ExportTo>\<version>\ and not published.
  [string]$ExportTo,
  # Where the Android APK and the Linux bundle are built. This PC builds nothing.
  [string]$Laptop = 'Maro@192.168.3.28',
  [string]$LaptopKey = 'C:/Users/Maro/Documents/Droplets/local/backup/2026-11-02-deprecated-laptop/marolaptop/id_ed25519_marolaptop',
  [string]$LaptopDir = 'C:\build\hourglass-release'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
# [IO.File] resolves relative paths against the process's directory, not Set-Location's.
[Environment]::CurrentDirectory = $repo

$Key = 'C:\Users\Maro\Documents\Droplets\bluehost\id_ed25519_bluehost'
$Droplet = 'root@129.121.150.7'
$WebRoot = '/var/www/marobotic.dev/apps'
$Base = 'https://marobotic.dev/apps'
$ssh = @('-i', $Key, '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=20')
# The laptop builds the Android APK and the Linux bundle (Maro's rule: nothing is
# built on this PC). Its ssh shell is PowerShell, so the commands below are too.
$laptopSsh = @('-i', $LaptopKey, '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=20')
$laptopScp = $LaptopDir.Replace('\', '/')   # scp wants forward slashes in a Windows path

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Edit-File($path, $pattern, $replacement) {
  $text = [IO.File]::ReadAllText($path)
  if ($text -notmatch $pattern) { throw "no match for $pattern in $path" }
  [IO.File]::WriteAllText($path, ([regex]::Replace($text, $pattern, $replacement)))
}
function Sha($f) { (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower() }
# JSON without a byte-order mark (Windows PowerShell's utf8 adds one, and Android's parser rejects it).
function Write-Json($obj, $path) { [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false)) }
# One command on the laptop; anything but success stops the release.
function Run-Laptop($cmd) {
  & ssh @laptopSsh $Laptop $cmd
  if ($LASTEXITCODE -ne 0) { throw "on $Laptop, this failed: $cmd" }
}
# The build folder there is deleted whatever happens: its disk is small and shared.
function Clear-LaptopBuild {
  & ssh @laptopSsh $Laptop "if (Test-Path '$LaptopDir') { Remove-Item '$LaptopDir' -Recurse -Force }" | Out-Null
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version looks like 1.2.3" }
if ((git branch --show-current) -ne 'main') { throw "release from main" }
if (git status --porcelain) { throw "commit or stash your changes first" }

# ---------------------------------------------------------------- 1. version
Step "Version $Version"
$gradle = 'android\app\build.gradle.kts'
# Resuming: a run that stopped after pushing "Hourglass <version>" picks up from there.
$resume = [IO.File]::ReadAllText('server\app.js') -match ('VERSION = "' + [regex]::Escape($Version) + '"')
$code = [int]([regex]::Match([IO.File]::ReadAllText($gradle), 'versionCode = (\d+)').Groups[1].Value)
$build = [int]([regex]::Match([IO.File]::ReadAllText('ios\project.yml'), 'CURRENT_PROJECT_VERSION: "(\d+)"').Groups[1].Value)
if ($resume) {
  "  resuming: $Version is already committed"
} else {
  $code++; $build++
  Edit-File 'server\app.js' 'VERSION = "[^"]+"' "VERSION = `"$Version`""
  Edit-File $gradle 'versionCode = \d+' "versionCode = $code"
  Edit-File $gradle 'versionName = "[^"]+"' "versionName = `"$Version`""
  Edit-File 'ios\project.yml' 'MARKETING_VERSION: "[^"]+"' "MARKETING_VERSION: `"$Version`""
  Edit-File 'ios\project.yml' 'CURRENT_PROJECT_VERSION: "\d+"' "CURRENT_PROJECT_VERSION: `"$build`""
}
"  Android versionCode $code, iOS build $build"

# A dry run puts the version files back when it ends, even when a step fails.
trap {
  Clear-LaptopBuild
  if ($DryRun) { git -C $repo checkout -- server/app.js android/app/build.gradle.kts ios/project.yml }
  break
}
$out = Join-Path $env:TEMP "hourglass-release-$Version"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null

if (-not $DryRun -and -not $resume) {
  git add server/app.js $gradle ios/project.yml
  git -c user.name=Marobotic -c user.email=marobotus@icloud.com commit -q -m "Hourglass $Version"
  git push -q origin main
}
# CI builds the commit that set this version (later commits may not touch the apps).
$sha = if ($resume) { git log -1 --format=%H --fixed-strings --grep "Hourglass $Version" } else { git rev-parse HEAD }
if (-not $sha) { $sha = git rev-parse HEAD }

# ---------------------------------------------------------------- 2. laptop builds
# Nothing is built on this PC (Maro's rule). The source the two builds need goes
# to the laptop as a tarball over ssh; the build, the signing and the bundling
# happen there, and only the APK and the bundle come back.
Step "Laptop builds ($Laptop)"
# Windows' own tar: GNU tar from Git Bash reads C: as a remote host. Build
# outputs, gradle caches and android/local.properties (the signing passwords)
# stay on this PC; server/node_modules travels because the Linux bundle ships
# it, exactly as it always has.
$tarExe = "$env:SystemRoot\System32\tar.exe"
$srcDir = "$out\laptop"
New-Item -ItemType Directory -Force $srcDir | Out-Null
$source = "$srcDir\source.tar.gz"
& $tarExe -czf $source -C $repo `
  --exclude=android/build --exclude=android/app/build --exclude=android/.gradle `
  --exclude=android/.kotlin --exclude=android/local.properties `
  --exclude=core/test --exclude=server/test --exclude=server/data --exclude=server/calls.jsonl `
  android core server assets linux
if ($LASTEXITCODE -ne 0) { throw "tar of the source failed" }

# This runs on the laptop, as a file, so nothing has to survive ssh quoting.
# @DIR@ is the build folder there. The signing values are read from the laptop's
# own C:\Users\Maro\.marobotic\keys\release.properties: no secret is in the repo,
# the tarball, or this script.
$laptopScript = @'
$ErrorActionPreference = 'Stop'
$dir = '@DIR@'
Set-Location $dir
& "$env:SystemRoot\System32\tar.exe" -xzf (Join-Path $dir 'source.tar.gz') -C $dir
if ($LASTEXITCODE -ne 0) { throw 'could not unpack the source' }
Remove-Item (Join-Path $dir 'source.tar.gz') -Force

# android/local.properties: the laptop's SDK and its own copy of the release key.
# Forward slashes, because a Java properties file reads a backslash as an escape.
# Without the key Gradle silently falls back to the debug key, and an APK signed
# with that cannot install over a published Hourglass, so fail here instead.
$props = @('sdk.dir=' + $env:ANDROID_HOME.Replace('\', '/'), 'hourglass.server=https://marobotic.dev/hourglass')
$release = 'C:\Users\Maro\.marobotic\keys\release.properties'
if (-not (Test-Path $release)) { throw "no $release on the laptop: the APK would be signed with the debug key" }
foreach ($line in Get-Content $release) { if ($line -match '^release\.') { $props += $line.Trim() } }
foreach ($need in 'release.keystore', 'release.storePassword', 'release.keyAlias', 'release.keyPassword') {
  if (-not ($props -match ('^' + [regex]::Escape($need + '=')))) { throw "release.properties has no $need" }
}
$keystore = ($props | Where-Object { $_ -like 'release.keystore=*' }).Substring(('release.keystore=').Length)
if (-not (Test-Path $keystore)) { throw "no keystore at $keystore" }
[IO.File]::WriteAllLines((Join-Path $dir 'android\local.properties'), $props, (New-Object Text.UTF8Encoding $false))

# Gradle's daemons keep their pipes open, which leaves ssh waiting forever: the
# output goes into a log file and only a failed build prints the end of it.
$log = Join-Path $dir 'gradle.log'
Push-Location (Join-Path $dir 'android')
$ErrorActionPreference = 'Continue'
& .\gradlew.bat assembleRelease --no-daemon > $log 2>&1
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Pop-Location
if ($code -ne 0) { Get-Content $log -Tail 80; throw "gradle failed ($code), log: $log" }

# The Linux bundle: the same layout the release has always shipped (the repo's
# parts, minus tests and local data), tarred by Windows' own tar.
$stage = Join-Path $dir 'stage\hourglass'
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($x in 'core', 'server', 'assets', 'linux') { Copy-Item (Join-Path $dir $x) (Join-Path $stage $x) -Recurse -Force }
foreach ($x in 'core\test', 'server\test', 'server\data') { if (Test-Path (Join-Path $stage $x)) { Remove-Item (Join-Path $stage $x) -Recurse -Force } }
& "$env:SystemRoot\System32\tar.exe" -czf (Join-Path $dir 'hourglass-linux.tar.gz') -C (Join-Path $dir 'stage') hourglass
if ($LASTEXITCODE -ne 0) { throw 'tar of the Linux bundle failed' }
Remove-Item (Join-Path $dir 'stage') -Recurse -Force
'built'
'@
$laptopScript = $laptopScript.Replace('@DIR@', $LaptopDir)

Run-Laptop "if (Test-Path '$LaptopDir') { Remove-Item '$LaptopDir' -Recurse -Force }; New-Item -ItemType Directory -Force '$LaptopDir' | Out-Null"
$helper = "$srcDir\laptop-build.ps1"
[IO.File]::WriteAllText($helper, $laptopScript, (New-Object Text.UTF8Encoding $false))
& scp @laptopSsh $source "${Laptop}:$laptopScp/source.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "could not send the source to $Laptop" }
& scp @laptopSsh $helper "${Laptop}:$laptopScp/build.ps1"
if ($LASTEXITCODE -ne 0) { throw "could not send the build script to $Laptop" }
Run-Laptop "powershell -NoProfile -ExecutionPolicy Bypass -File $LaptopDir\build.ps1"

$apk = "$out\Hourglass-$Version.apk"
& scp @laptopSsh "${Laptop}:$laptopScp/android/app/build/outputs/apk/release/app-release.apk" $apk
if ($LASTEXITCODE -ne 0) { throw "no APK came back from $Laptop" }
$linux = "$out\hourglass-$Version-linux.tar.gz"
& scp @laptopSsh "${Laptop}:$laptopScp/hourglass-linux.tar.gz" $linux
if ($LASTEXITCODE -ne 0) { throw "no Linux bundle came back from $Laptop" }
Clear-LaptopBuild
"  $(Split-Path -Leaf $apk)"
"  $(Split-Path -Leaf $linux)"

# ---------------------------------------------------------------- 3. CI builds
function Wait-Run($workflow) {
  for ($i = 0; $i -lt 60; $i++) {
    $runs = gh run list --workflow $workflow --commit $sha --json databaseId --limit 1 | ConvertFrom-Json
    if ($runs.Count) { break }
    Start-Sleep 10
  }
  if (-not $runs.Count) { throw "no $workflow run for $sha" }
  $id = $runs[0].databaseId
  Write-Host "  $workflow run $id"   # Write-Host: anything else would become part of the return value
  gh run watch $id --exit-status --interval 30 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "$workflow run $id failed: gh run view $id --log-failed" }
  return $id
}
if ($DryRun) {
  Step "Dry run: using the latest successful CI builds instead of waiting"
  $winRun = (gh run list --workflow Windows --status success --limit 1 --json databaseId | ConvertFrom-Json)[0].databaseId
  $iosRun = (gh run list --workflow iOS --status success --limit 1 --json databaseId | ConvertFrom-Json)[0].databaseId
} else {
  Step "Waiting for CI"
  $winRun = Wait-Run 'Windows'
  $iosRun = Wait-Run 'iOS'
}
# CI puts both builds on the latest-build release (Actions artifact storage
# runs out); both runs above finished on this commit, so those are its builds.
gh release download latest-build -p Hourglass-setup.exe -D "$out\ci-win" --clobber
gh release download latest-build -p Hourglass.ipa -D "$out\ci-ios" --clobber
$exe = "$out\Hourglass-$Version-setup.exe"
Copy-Item (Get-ChildItem "$out\ci-win\*.exe" | Select-Object -First 1).FullName $exe
$ipa = "$out\Hourglass-$Version.ipa"
Copy-Item (Get-ChildItem "$out\ci-ios\*.ipa" | Select-Object -First 1).FullName $ipa

# ---------------------------------------------------------------- 4. feed
Step "Feed"
$dir = "$Base/hourglass/$Version"
$date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$feed = [ordered]@{
  app = 'hourglass'; name = 'Hourglass'; version = $Version; date = $date; notes = $Notes
  windows = [ordered]@{ url = "$dir/$(Split-Path -Leaf $exe)"; sha256 = (Sha $exe); size = (Get-Item $exe).Length }
  android = [ordered]@{ url = "$dir/$(Split-Path -Leaf $apk)"; sha256 = (Sha $apk); size = (Get-Item $apk).Length; versionCode = $code }
  ios = [ordered]@{ url = "$dir/$(Split-Path -Leaf $ipa)"; sha256 = (Sha $ipa); size = (Get-Item $ipa).Length; version = $Version; build = "$build" }
  linux = [ordered]@{ url = "$dir/$(Split-Path -Leaf $linux)"; sha256 = (Sha $linux); size = (Get-Item $linux).Length }
}
Write-Json $feed "$out\latest.json"

# SideStore (AltStore source format): every marobotic iOS app in one source.
$source = try { Invoke-RestMethod "$Base/sidestore.json" -TimeoutSec 15 } catch { $null }
if (-not $source) {
  $source = [pscustomobject]@{ name = 'Marobotic'; identifier = 'dev.marobotic.source'; subtitle = 'Apps by Marobotic'; website = 'https://marobotic.dev'; iconURL = "$Base/icon.png"; tintColor = 'B14242'; apps = @(); news = @() }
}
$entry = [pscustomobject]@{
  name = 'Hourglass'; bundleIdentifier = 'dev.marobotic.hourglass'; developerName = 'Marobotic'
  subtitle = 'The right notes at the right moment'
  localizedDescription = 'Calendar, notes, alarms and timers in one app. When a lecture is on, its notes are already open.'
  iconURL = "$Base/hourglass/icon.png"; tintColor = 'B14242'
  versions = @([pscustomobject]@{ version = $Version; buildVersion = "$build"; date = $date; localizedDescription = $Notes; downloadURL = $feed.ios.url; size = $feed.ios.size; minOSVersion = '18.0' })
  appPermissions = [pscustomobject]@{ entitlements = @(); privacy = [pscustomobject]@{} }
}
$others = @($source.apps | Where-Object { $_.bundleIdentifier -ne 'dev.marobotic.hourglass' })
$source.apps = @($others + $entry)
Write-Json $source "$out\sidestore.json"

Get-ChildItem $out -File | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
if ($DryRun) {
  git checkout -- server/app.js $gradle ios/project.yml
  Step "Dry run: nothing uploaded, version files put back. Files in $out"
  return
}

if ($ExportTo) {
  $dest = Join-Path $ExportTo $Version
  New-Item -ItemType Directory -Force $dest | Out-Null
  Copy-Item $exe, $apk, $ipa, $linux, "$out\latest.json" $dest -Force
  Step "Exported to $dest (not published: marobotic.dev still offers the previous version)"
  Get-ChildItem $dest -File | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
  return
}

# ---------------------------------------------------------------- 5. upload
Step "Upload"
& ssh @ssh $Droplet "mkdir -p $WebRoot/hourglass/$Version"
& scp @ssh $exe $apk $ipa $linux "${Droplet}:$WebRoot/hourglass/$Version/"
if ($LASTEXITCODE -ne 0) { throw "upload failed" }
if (-not (Test-Path 'assets\icon-256.png')) { throw "no assets\icon-256.png" }
& scp @ssh 'assets\icon-256.png' "${Droplet}:$WebRoot/hourglass/icon.png"
# The feed and the source go last, and by rename, so nobody reads half a file.
& scp @ssh "$out\latest.json" "${Droplet}:$WebRoot/hourglass/latest.json.new"
& scp @ssh "$out\sidestore.json" "${Droplet}:$WebRoot/sidestore.json.new"
& ssh @ssh $Droplet "mv $WebRoot/hourglass/latest.json.new $WebRoot/hourglass/latest.json && mv $WebRoot/sidestore.json.new $WebRoot/sidestore.json && chmod -R a+rX $WebRoot"
Step "Hourglass $Version is out: $Base/hourglass/latest.json"

Step "Project Exports"
$exports = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Project Exports\Hourglass'
Add-Type -AssemblyName Microsoft.VisualBasic
foreach ($p in @(@('Windows', $exe), @('Android', $apk), @('iOS', $ipa), @('Linux', $linux))) {
  $to = Join-Path $exports $p[0]
  New-Item -ItemType Directory -Force $to | Out-Null
  # Older versions only: the uninstaller and anything not named for a version stay.
  Get-ChildItem $to -File | Where-Object { $_.Name -match '^hourglass-\d+\.\d+\.\d+' -and $_.Name -ne (Split-Path -Leaf $p[1]) } |
    ForEach-Object { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($_.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin') }
  Copy-Item $p[1] $to -Force
}
"  $exports"
# Depot (the marobotic app updater) reads a signed catalog of every app's feed.
$depot = "C:\Users\Maro\Documents\GitHub\maro-projects-plans\depot\tools\publish-catalog.ps1"
if (Test-Path $depot) { Step "Depot catalog"; & $depot }
