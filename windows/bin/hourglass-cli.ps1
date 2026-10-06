# hourglass-cli: call Hourglass actions from a shell (for agents without MCP, and scripts).
#   hourglass-cli now
#   hourglass-cli <action> '<json args>'      e.g. hourglass-cli add_note '{"course":"Algorithms","body":"..."}'
#   hourglass-cli actions                     list actions and their arguments
param(
  [Parameter(Position = 0)] [string] $Action = 'now',
  [Parameter(Position = 1)] [string] $Body = '{}'
)
$ErrorActionPreference = 'Stop'
$port = if ($env:HOURGLASS_PORT) { $env:HOURGLASS_PORT } else { '8931' }
$conf = if ($env:HOURGLASS_CONFIG) { $env:HOURGLASS_CONFIG } else { Join-Path $env:APPDATA 'Hourglass' }
$token = (Get-Content (Join-Path $conf 'token') -Raw).Trim()
$base = "http://127.0.0.1:$port"

try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "$base/health").StatusCode -eq 200 | Out-Null } catch {
  $root = Split-Path -Parent $PSScriptRoot
  $node = Join-Path $root 'node\node.exe'
  if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
  Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList "`"$root\sidecar\hourglassd.js`""
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 100
    try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "$base/health").StatusCode -eq 200 | Out-Null; break } catch {}
  }
}

$headers = @{ Authorization = "Bearer $token" }
switch ($Action) {
  'now' { $res = Invoke-WebRequest -UseBasicParsing -Headers $headers "$base/api/now" }
  'actions' { $res = Invoke-WebRequest -UseBasicParsing -Headers $headers "$base/api/actions" }
  { $_ -in '-h', '--help', 'help' } { Get-Content $MyInvocation.MyCommand.Path | Select-Object -Skip 1 -First 5; exit }
  default {
    $headers['Content-Type'] = 'application/json'
    $res = Invoke-WebRequest -UseBasicParsing -Method Post -Headers $headers -Body $Body "$base/api/actions/$Action"
  }
}
$res.Content
