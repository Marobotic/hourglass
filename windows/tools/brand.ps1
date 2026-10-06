# Gives the app and its service their own names in Task Manager.
#
# The window runs in Qt's qml.exe ("QML Runtime") and the service in node.exe
# ("Node.js JavaScript Runtime"). This makes stamped copies next to them -
# qt\bin\Hourglass.exe and node\hourglassd.exe - with Hourglass's name,
# description and icon, which the launcher and the service then prefer.
# The originals are left as they are. Run again after updating Qt or Node.
#
#   .\tools\brand.ps1                     # downloads rcedit (electron/rcedit) to %TEMP%
#   .\tools\brand.ps1 -Rcedit C:\path\rcedit-x64.exe
param([string]$Rcedit)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$icon = Join-Path $root 'hourglass.ico'

if (-not $Rcedit) {
  $Rcedit = Join-Path $env:TEMP 'rcedit-x64.exe'
  if (-not (Test-Path $Rcedit)) {
    Write-Host 'Downloading rcedit...'
    Invoke-WebRequest -UseBasicParsing 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' -OutFile $Rcedit
  }
}

function Stamp($source, $target, $description) {
  if (-not (Test-Path $source)) { Write-Host "Skipped $target ($source not found)"; return }
  Copy-Item $source $target -Force
  $name = Split-Path -Leaf $target
  & $Rcedit $target `
    --set-version-string FileDescription $description `
    --set-version-string ProductName 'Hourglass' `
    --set-version-string CompanyName 'Marobotic' `
    --set-version-string InternalName ($name -replace '\.exe$', '') `
    --set-version-string OriginalFilename $name `
    --set-icon $icon
  if ($LASTEXITCODE -ne 0) { throw "rcedit failed on $target" }
  Write-Host "Made $target ($description)"
}

Stamp (Join-Path $root 'qt\bin\qml.exe') (Join-Path $root 'qt\bin\Hourglass.exe') 'Hourglass'
Stamp (Join-Path $root 'node\node.exe') (Join-Path $root 'node\hourglassd.exe') 'Hourglass service'
