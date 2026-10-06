# Installs/removes the Hourglass background service at Windows sign-in.
# Windows stand-in for linux/share/hourglassd.service (a systemd user unit):
# it makes alarms and timers ring even when the window is closed.
param([switch]$Remove)
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Hourglass service.lnk'
if ($Remove) {
  Remove-Item $lnk -ErrorAction SilentlyContinue
  Write-Host 'Removed the Hourglass service from startup.'
  exit
}
$shell = New-Object -ComObject WScript.Shell
$l = $shell.CreateShortcut($lnk)
$l.TargetPath = 'wscript.exe'
$l.Arguments = "`"$root\bin\hourglassd.vbs`""
$l.WorkingDirectory = $root
$l.Save()
Write-Host "Startup shortcut written: $lnk"
