; Hourglass for Windows - the installer (Inno Setup 6).
;
;   ISCC /DAppVersion=0.2.1 /DPackage=..\..\dist\Hourglass windows\installer\Hourglass.iss
;
; Package is the folder CI assembles (.github/workflows/windows.yml): the repo's
; core\, server\ and assets\, and windows\ with node\ and qt\bin\ inside it, so the
; app finds its parts by the same relative paths it uses in a checkout.
;
; Per user, no admin prompt: %LOCALAPPDATA%\Programs\Hourglass. Settings and data
; stay in %APPDATA%\Hourglass and %LOCALAPPDATA%\Hourglass and survive updates and
; uninstalling. The app updates itself by running a newer setup.exe with
; /VERYSILENT /RELAUNCH (see the service's installUpdate()).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Package
  #define Package "..\..\dist\Hourglass"
#endif

[Setup]
AppId={{6E1A0C52-3C7B-4F3A-9C1D-5B8E2D4F7A90}
AppName=Hourglass
AppVersion={#AppVersion}
AppVerName=Hourglass {#AppVersion}
AppPublisher=Marobotic
AppPublisherURL=https://marobotic.dev
AppSupportURL=https://marobotic.dev
DefaultDirName={localappdata}\Programs\Hourglass
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=Hourglass-{#AppVersion}-setup
SetupIconFile=..\hourglass.ico
UninstallDisplayIcon={app}\windows\hourglass.ico
UninstallDisplayName=Hourglass
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[InstallDelete]
; Code from the old version goes first, so a file a release removed does not linger.
Type: filesandordirs; Name: "{app}\core"
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\windows\app"
Type: filesandordirs; Name: "{app}\windows\sidecar"

[Files]
Source: "{#Package}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\Hourglass"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\Hourglass.vbs"""; WorkingDir: "{app}\windows"; IconFilename: "{app}\windows\hourglass.ico"; Comment: "Calendar, notes, alarms and timers"
; The background service at sign-in: alarms and timers ring with the window closed.
Name: "{userstartup}\Hourglass service"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\bin\hourglassd.vbs"""; WorkingDir: "{app}\windows"; IconFilename: "{app}\windows\hourglass.ico"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\Hourglass.vbs"""; Description: "Open Hourglass"; Flags: postinstall nowait skipifsilent
; A silent update from inside the app: start it again.
Filename: "{sys}\wscript.exe"; Parameters: """{app}\windows\Hourglass.vbs"""; Flags: nowait; Check: Relaunch

[Code]
function Relaunch: Boolean;
begin
  Result := WizardSilent and (Pos('/RELAUNCH', UpperCase(GetCmdTail)) > 0);
end;

// The window and the service of this user, by their own exe names (the stamped
// copies tools\brand.ps1 makes), so nothing else is touched.
procedure StopHourglass;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM hourglassd.exe /FI "USERNAME eq ' + GetUserNameString + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM Hourglass.exe /FI "USERNAME eq ' + GetUserNameString + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopHourglass;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopHourglass;
end;
