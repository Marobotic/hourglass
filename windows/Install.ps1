# Adds Hourglass to the Start menu, adds bin\ to the user PATH (hourglass and
# hourglass-cli), and starts the background service at sign-in so alarms and
# timers ring even when the window is closed.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$shell = New-Object -ComObject WScript.Shell
function New-Link($path, $target, $arguments) {
  $l = $shell.CreateShortcut($path)
  $l.TargetPath = $target
  $l.Arguments = $arguments
  $l.WorkingDirectory = $root
  $l.IconLocation = "$root\hourglass.ico"
  $l.Save()
}
# Name the window and the service "Hourglass" in Task Manager.
if (-not (Test-Path "$root\qt\bin\Hourglass.exe") -or -not (Test-Path "$root\node\hourglassd.exe")) {
  try { & "$root\tools\brand.ps1" } catch { Write-Host "Could not name the processes (they will show as QML Runtime / Node.js): $_" }
}
$menu = [Environment]::GetFolderPath('Programs')
New-Link "$menu\Hourglass.lnk" "wscript.exe" "`"$root\Hourglass.vbs`""
& "$root\share\hourglass-service.ps1"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$root\bin*") {
  [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ";$root\bin").Trim(';'), 'User')
  Write-Host "Added $root\bin to your PATH."
}
Write-Host "Hourglass is in the Start menu. The service now starts when you sign in."
