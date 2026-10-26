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
; uninstalling (the account stays signed in). Any older Hourglass goes first: its
; window and service are stopped wherever they run from (a git checkout too), the
; old program files are deleted, and PATH entries an old Install.ps1 added go. The app updates itself by running a newer setup.exe with
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
DisableReadyPage=no
DisableWelcomePage=yes
DisableFinishedPage=yes
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
; The whole old version goes first, so nothing of it lingers.
Type: filesandordirs; Name: "{app}\*"

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
const
  UninstKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6E1A0C52-3C7B-4F3A-9C1D-5B8E2D4F7A90}_is1';

var
  OldVersion: String; // the version already installed, '' on a first install

// Takes the next number off a dotted version.
function VerPart(var S: String): Integer;
var
  P: Integer;
begin
  P := Pos('.', S);
  if P = 0 then begin
    Result := StrToIntDef(S, 0);
    S := '';
  end else begin
    Result := StrToIntDef(Copy(S, 1, P - 1), 0);
    Delete(S, 1, P);
  end;
end;

// 1 when A is newer than B, -1 when older, 0 when the same.
function VerCompare(A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  for I := 1 to 4 do begin
    X := VerPart(A);
    Y := VerPart(B);
    if X <> Y then begin
      if X > Y then Result := 1 else Result := -1;
      Exit;
    end;
  end;
end;

function GetInstalledVersion(): String;
var
  Lines: TArrayOfString;
  I, P1, P2: Integer;
  AppJs, FileVer, RegVer: String;
begin
  FileVer := '';
  RegVer := '';
  AppJs := ExpandConstant('{localappdata}\Programs\Hourglass\server\app.js');
  if FileExists(AppJs) and LoadStringsFromFile(AppJs, Lines) then begin
    for I := 0 to GetArrayLength(Lines) - 1 do begin
      P1 := Pos('VERSION = "', Lines[I]);
      if P1 > 0 then begin
        P1 := P1 + Length('VERSION = "');
        P2 := Pos('"', Copy(Lines[I], P1, Length(Lines[I])));
        if P2 > 0 then begin
          FileVer := Copy(Lines[I], P1, P2 - 1);
          Break;
        end;
      end;
    end;
  end;
  if FileVer <> '' then
    Result := FileVer
  else if RegQueryStringValue(HKCU, UninstKey, 'DisplayVersion', RegVer) and (RegVer <> '') then
    Result := RegVer
  else if FileExists(ExpandConstant('{localappdata}\Programs\Hourglass\windows\Hourglass.vbs')) or
          FileExists(ExpandConstant('{localappdata}\Programs\Hourglass\windows\qt\bin\Hourglass.exe')) then
    Result := 'an older version'
  else
    Result := '';
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  OldVersion := GetInstalledVersion();
  if (OldVersion <> '') and (OldVersion <> 'an older version') and (VerCompare(OldVersion, '{#AppVersion}') > 0) then
    Result := SuppressibleMsgBox('A newer Hourglass (' + OldVersion + ') is already installed.' + #13#10#13#10 +
      'Replace it with the older version {#AppVersion}?', mbConfirmation, MB_YESNO, IDYES) = IDYES;
end;

procedure InitializeWizard();
begin
  if OldVersion <> '' then WizardForm.Caption := 'Update Hourglass';
end;

function VersionText(): String;
begin
  if OldVersion = 'an older version' then Result := OldVersion else Result := 'version ' + OldVersion;
end;

// The first (and only) page before installing: Install, Update or Reinstall.
procedure ShowReadyPage();
var
  Same: Boolean;
begin
  WizardForm.ReadyMemo.Visible := False;
  WizardForm.ReadyLabel.AutoSize := False;
  WizardForm.ReadyLabel.WordWrap := True;
  WizardForm.ReadyLabel.Height := ScaleY(150);
  Same := (OldVersion <> '') and (OldVersion <> 'an older version') and (VerCompare(OldVersion, '{#AppVersion}') = 0);
  if OldVersion = '' then begin
    WizardForm.PageNameLabel.Caption := 'Install Hourglass {#AppVersion}';
    WizardForm.PageDescriptionLabel.Caption := 'Calendar, notes, alarms and timers.';
    WizardForm.ReadyLabel.Caption := 'Click Install to set up Hourglass {#AppVersion}.' + #13#10#13#10 +
      'It takes a few seconds. The app opens by itself when it''s done.';
    WizardForm.NextButton.Caption := 'Install';
  end else if Same then begin
    WizardForm.PageNameLabel.Caption := 'Reinstall Hourglass {#AppVersion}';
    WizardForm.PageDescriptionLabel.Caption := 'This version is already installed.';
    WizardForm.ReadyLabel.Caption := 'You already have version ' + OldVersion + ', the same version as this installer.' + #13#10#13#10 +
      'Reinstalling refreshes its files. Your account and notes are kept. The app closes during the reinstall and opens again when it''s done.';
    WizardForm.NextButton.Caption := 'Reinstall';
  end else begin
    WizardForm.Caption := 'Update Hourglass';
    WizardForm.PageNameLabel.Caption := 'Update Hourglass';
    if OldVersion = 'an older version' then
      WizardForm.PageDescriptionLabel.Caption := 'To version {#AppVersion}'
    else
      WizardForm.PageDescriptionLabel.Caption := 'Version ' + OldVersion + '  ' + #$2192 + '  version {#AppVersion}';
    WizardForm.ReadyLabel.Caption := 'You have ' + VersionText() + ' installed. This update brings it to version {#AppVersion}.' + #13#10#13#10 +
      'Your account and notes are kept. The app closes during the update and opens again when it''s done.';
    WizardForm.NextButton.Caption := 'Update';
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then ShowReadyPage();
end;

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
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM hourglassd.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM Hourglass.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
end;

// An older Hourglass that is not this install: one run from a checkout or an
// old folder (node.exe / qml.exe under ...\hourglass\windows\), anything still
// holding the service's port, and the PATH entries an old Install.ps1 added.
procedure RemoveOldHourglass;
var
  Code: Integer;
  Ps, Script: String;
begin
  Ps := 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match "\\hourglass\\windows\\(node|qt)\\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ' +
    '$c = Get-NetTCPConnection -LocalPort 8931 -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }; ' +
    '$p = [Environment]::GetEnvironmentVariable("Path", "User"); if ($p) { $n = ($p -split ";" | Where-Object { $_ -and $_ -notmatch "\\hourglass\\windows\\bin\\?$" }) -join ";"; if ($n -ne $p) { [Environment]::SetEnvironmentVariable("Path", $n, "User") } }';
  // As a file: its quotes would not survive a -Command line.
  Script := ExpandConstant('{tmp}\remove-old-hourglass.ps1');
  SaveStringToFile(Script, Ps, False);
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Script + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(500);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopHourglass;
  RemoveOldHourglass;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopHourglass;
end;
