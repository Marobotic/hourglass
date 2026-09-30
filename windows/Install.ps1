# Adds Hourglass to the Start menu, and starts the background service at
# sign-in so alarms and timers ring even when the window is closed.
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
$menu = [Environment]::GetFolderPath('Programs')
$startup = [Environment]::GetFolderPath('Startup')
New-Link "$menu\Hourglass.lnk" "wscript.exe" "`"$root\Hourglass.vbs`""
New-Link "$startup\Hourglass service.lnk" "$root\node\node.exe" "`"$root\linux\sidecar\hourglassd.js`""
Write-Host "Hourglass is in the Start menu. The service now starts when you sign in."
