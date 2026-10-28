$ErrorActionPreference = 'Stop'
$temp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
$portListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portListener.Start()
$port = $portListener.LocalEndpoint.Port
$portListener.Stop()
$counter = Join-Path $temp 'requests.txt'
$launches = Join-Path $temp 'launches.txt'
$job = $null

try {
  $appData = Join-Path $temp 'appdata'
  $install = Join-Path $temp 'install'
  $null = New-Item -ItemType Directory -Force -Path (Join-Path $appData 'Hourglass'), (Join-Path $install 'qt\bin')
  Set-Content -NoNewline -Path (Join-Path $appData 'Hourglass\token') -Value 'test-token'
  Set-Content -NoNewline -Path (Join-Path $install 'qt\bin\Hourglass.exe') -Value 'test placeholder'
  Copy-Item (Join-Path $PSScriptRoot '..\Hourglass.ps1') (Join-Path $install 'Hourglass.ps1')
  $env:APPDATA = $appData
  $env:HOURGLASS_PORT = [string]$port

  $job = Start-Job -ArgumentList $port, $counter -ScriptBlock {
    param($ListenPort, $CounterPath)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $ListenPort)
    $listener.Start()
    try {
      while ($true) {
        while (-not $listener.Pending()) { Start-Sleep -Milliseconds 20 }
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = [IO.StreamReader]::new($stream)
        $requestLine = $reader.ReadLine()
        while (($header = $reader.ReadLine()) -ne '') { }
        $path = ($requestLine -split ' ')[1]
        if ($path -eq '/api/window/show') {
          $n = 0
          if (Test-Path $CounterPath) { $n = [int](Get-Content $CounterPath -Raw) }
          Set-Content -NoNewline -Path $CounterPath -Value ([string]($n + 1))
          Start-Sleep -Seconds 7
          $body = '{"started":true}'
        } else {
          $body = '{"ok":true}'
        }
        $payload = [Text.Encoding]::UTF8.GetBytes($body)
        $headers = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($payload.Length)`r`nConnection: close`r`n`r`n")
        $stream.Write($headers, 0, $headers.Length)
        $stream.Write($payload, 0, $payload.Length)
        $stream.Flush()
        $reader.Dispose()
        $client.Close()
        if ($path -eq '/api/window/show') { break }
      }
    } finally {
      $listener.Stop()
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$port/health").StatusCode -eq 200) { break }
    } catch { Start-Sleep -Milliseconds 100 }
  }
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Fake HTTP server did not start.' }

  function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle)
    Add-Content -Path $launches -Value $FilePath
  }
  . (Join-Path $install 'Hourglass.ps1')

  $requestCount = if (Test-Path $counter) { [int](Get-Content $counter -Raw) } else { 0 }
  $launchCount = if (Test-Path $launches) { @(Get-Content $launches).Count } else { 0 }
  if ($requestCount -ne 1) { throw "Expected one window request; got $requestCount." }
  if ($launchCount -ne 0) { throw "Expected no launcher fallback; got $launchCount launch(es)." }
  Write-Output "PASS: delayed window request issued once; Start-Process launches: $launchCount"
} finally {
  if ($job) {
    if ($job.State -eq 'Running') { Stop-Job $job -ErrorAction SilentlyContinue }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Function:\Start-Process -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
