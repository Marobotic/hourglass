<#
  Publishes a new Hourglass to marobotic.dev, where the apps look for updates.

    .\tools\release.ps1 -Version 0.2.1 -Notes "Drive keeps only the files you open."
    .\tools\release.ps1 -Version 0.2.1 -Notes "..." -DryRun     # build everything, upload nothing

  1. Bumps the version (server/app.js, Android versionName/versionCode, iOS
     MARKETING_VERSION/CURRENT_PROJECT_VERSION), commits as Marobotic, pushes main.
     That push makes GitHub Actions build the Windows setup.exe and the iOS .ipa.
  2. Builds the Android APK here, signed with the release key (android/local.properties),
     and the Linux bundle.
  3. Waits for the two CI runs and downloads their builds.
  4. Uploads it all to /var/www/marobotic.dev/apps/hourglass/<version>/ on the droplet and
     writes latest.json (what the apps read) and the SideStore source last, so an app
     never sees a version whose files are not there yet.

  Needs: git, gh (signed in), ssh/scp, the release key, a clean main branch.
#>
param(
  [Parameter(Mandatory)] [string]$Version,
  [Parameter(Mandatory)] [string]$Notes,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$Key = 'C:\Users\Maro\Documents\Droplets\id_ed25519_claude'
$Droplet = 'root@157.245.131.195'
$WebRoot = '/var/www/marobotic.dev/apps'
$Base = 'https://marobotic.dev/apps'
$ssh = @('-i', $Key, '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=20')

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Edit-File($path, $pattern, $replacement) {
  $text = [IO.File]::ReadAllText($path)
  if ($text -notmatch $pattern) { throw "no match for $pattern in $path" }
  [IO.File]::WriteAllText($path, ([regex]::Replace($text, $pattern, $replacement)))
}
function Sha($f) { (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower() }
# JSON without a byte-order mark (Windows PowerShell's utf8 adds one, and Android's parser rejects it).
function Write-Json($obj, $path) { [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false)) }

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version looks like 1.2.3" }
if ((git branch --show-current) -ne 'main') { throw "release from main" }
if (git status --porcelain) { throw "commit or stash your changes first" }

# ---------------------------------------------------------------- 1. version
Step "Version $Version"
$gradle = 'android\app\build.gradle.kts'
$code = [int]([regex]::Match([IO.File]::ReadAllText($gradle), 'versionCode = (\d+)').Groups[1].Value) + 1
$build = [int]([regex]::Match([IO.File]::ReadAllText('ios\project.yml'), 'CURRENT_PROJECT_VERSION: "(\d+)"').Groups[1].Value) + 1
Edit-File 'server\app.js' 'VERSION = "[^"]+"' "VERSION = `"$Version`""
Edit-File $gradle 'versionCode = \d+' "versionCode = $code"
Edit-File $gradle 'versionName = "[^"]+"' "versionName = `"$Version`""
Edit-File 'ios\project.yml' 'MARKETING_VERSION: "[^"]+"' "MARKETING_VERSION: `"$Version`""
Edit-File 'ios\project.yml' 'CURRENT_PROJECT_VERSION: "\d+"' "CURRENT_PROJECT_VERSION: `"$build`""
"  Android versionCode $code, iOS build $build"

# A dry run puts the version files back when it ends, even when a step fails.
trap {
  if ($DryRun) { git -C $repo checkout -- server/app.js android/app/build.gradle.kts ios/project.yml }
  break
}
$out = Join-Path $env:TEMP "hourglass-release-$Version"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null

if (-not $DryRun) {
  git add server/app.js $gradle ios/project.yml
  git -c user.name=Marobotic -c user.email=marobotus@icloud.com commit -q -m "Hourglass $Version"
  git push -q origin main
}
$sha = git rev-parse HEAD

# ---------------------------------------------------------------- 2. local builds
Step "Android APK"
$env:JAVA_HOME = "$env:LOCALAPPDATA\Android\Sdk\jdk"
Push-Location android
& .\gradlew.bat -q assembleRelease
if ($LASTEXITCODE -ne 0) { throw "gradle failed" }
Pop-Location
if (-not (Select-String -Quiet -Path 'android\local.properties' -Pattern '^release\.keystore=')) { throw "no release key in android/local.properties: this APK could not update installed copies" }
$apk = "$out\Hourglass-$Version.apk"
Copy-Item 'android\app\build\outputs\apk\release\app-release.apk' $apk

Step "Linux bundle"
$stage = "$out\stage\hourglass"
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($x in 'core', 'server', 'assets', 'linux') { Copy-Item $x "$stage\$x" -Recurse }
foreach ($x in 'core\test', 'server\test', 'server\data') { if (Test-Path "$stage\$x") { Remove-Item "$stage\$x" -Recurse -Force } }
$linux = "$out\hourglass-$Version-linux.tar.gz"
tar -czf $linux -C "$out\stage" hourglass
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

# ---------------------------------------------------------------- 3. CI builds
function Wait-Run($workflow) {
  for ($i = 0; $i -lt 60; $i++) {
    $runs = gh run list --workflow $workflow --commit $sha --json databaseId --limit 1 | ConvertFrom-Json
    if ($runs.Count) { break }
    Start-Sleep 10
  }
  if (-not $runs.Count) { throw "no $workflow run for $sha" }
  $id = $runs[0].databaseId
  "  $workflow run $id"
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
gh run download $winRun -n Hourglass-setup -D "$out\ci-win"
gh run download $iosRun -n Hourglass-ipa -D "$out\ci-ios"
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
