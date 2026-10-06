' Hourglass sidecar service, without a console window: starts the background
' data/alarms/sync service. Used by Hourglass.ps1 and at Windows sign-in.
Set sh = CreateObject("WScript.Shell")
root = sh.CurrentDirectory
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
' hourglassd.exe is node.exe named "Hourglass service" (tools\brand.ps1).
node = root & "\node\hourglassd.exe"
If Not fso.FileExists(node) Then node = root & "\node\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
sh.Run Chr(34) & node & Chr(34) & " " & Chr(34) & root & "\sidecar\hourglassd.js" & Chr(34), 0, False
