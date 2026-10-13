# Gives the app and its service their own names in Task Manager. The service is
# the window's parent, so Task Manager shows one Hourglass with both inside.
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

# Qt gives its windows (title bar, taskbar, Alt+Tab) the exe's icon only if
# that icon is named IDI_ICON1; rcedit numbers it. Add the same icon group
# again under that name, pointing at the images rcedit already wrote.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HgIconName {
  delegate bool EnumNames(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryExW(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll")] static extern bool EnumResourceNamesW(IntPtr module, IntPtr type, EnumNames callback, IntPtr param);
  [DllImport("kernel32.dll")] static extern IntPtr FindResourceW(IntPtr module, IntPtr name, IntPtr type);
  [DllImport("kernel32.dll")] static extern IntPtr LoadResource(IntPtr module, IntPtr res);
  [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr data);
  [DllImport("kernel32.dll")] static extern uint SizeofResource(IntPtr module, IntPtr res);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr BeginUpdateResourceW(string file, bool deleteExisting);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool UpdateResourceW(IntPtr update, IntPtr type, string name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool EndUpdateResourceW(IntPtr update, bool discard);
  public static void Add(string exe) {
    IntPtr RT_GROUP_ICON = (IntPtr)14;
    IntPtr module = LoadLibraryExW(exe, IntPtr.Zero, 0x2); // LOAD_LIBRARY_AS_DATAFILE
    if (module == IntPtr.Zero) throw new Exception("cannot open " + exe);
    byte[] group = null;
    try {
      IntPtr first = IntPtr.Zero;
      EnumResourceNamesW(module, RT_GROUP_ICON, (m, t, n, p) => { first = n; return false; }, IntPtr.Zero);
      if (first == IntPtr.Zero) throw new Exception(exe + " has no icon");
      if (((long)first >> 16) != 0) return; // already named (IDI_ICON1)
      IntPtr res = FindResourceW(module, first, RT_GROUP_ICON);
      uint size = SizeofResource(module, res);
      group = new byte[size];
      Marshal.Copy(LockResource(LoadResource(module, res)), group, 0, (int)size);
    } finally { FreeLibrary(module); }
    IntPtr update = BeginUpdateResourceW(exe, false);
    if (update == IntPtr.Zero) throw new Exception("cannot write " + exe);
    if (!UpdateResourceW(update, RT_GROUP_ICON, "IDI_ICON1", 0x0409, group, (uint)group.Length)) { EndUpdateResourceW(update, true); throw new Exception("cannot add IDI_ICON1"); }
    if (!EndUpdateResourceW(update, false)) throw new Exception("cannot save " + exe);
  }

  // The qml runtime then sets its own window icon over that: a 64x64 Qt logo
  // PNG kept in its Qt resources as [4-byte big-endian length][PNG]. Put
  // Hourglass's PNG in that slot (it has to fit) and fix the length.
  public static void ReplaceQtLogo(string exe, byte[] png) {
    byte[] d = System.IO.File.ReadAllBytes(exe);
    byte[] sig = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
    for (int i = 4; i + 24 < d.Length; i++) {
      bool hit = true;
      for (int k = 0; k < 8 && hit; k++) hit = d[i + k] == sig[k];
      if (!hit) continue;
      int len = (d[i - 4] << 24) | (d[i - 3] << 16) | (d[i - 2] << 8) | d[i - 1];
      int w = (d[i + 16] << 24) | (d[i + 17] << 16) | (d[i + 18] << 8) | d[i + 19];
      // a Qt resource entry: its length prefix ends right after the PNG's IEND chunk
      if (w != 64 || len < 57 || i + len > d.Length || d[i + len - 8] != 0x49 || d[i + len - 7] != 0x45 || d[i + len - 6] != 0x4E || d[i + len - 5] != 0x44) continue;
      if (png.Length > len) throw new Exception("the icon PNG is " + png.Length + " bytes; Qt's logo slot holds " + len);
      d[i - 4] = (byte)(png.Length >> 24); d[i - 3] = (byte)(png.Length >> 16); d[i - 2] = (byte)(png.Length >> 8); d[i - 1] = (byte)png.Length;
      Array.Clear(d, i, len);
      Array.Copy(png, 0, d, i, png.Length);
      System.IO.File.WriteAllBytes(exe, d);
      return;
    }
    throw new Exception("Qt's logo was not found in " + exe);
  }

  // The 48 px image in hourglass.ico (the 64 px one does not fit the slot).
  public static byte[] IcoPng(string ico, int size) {
    byte[] d = System.IO.File.ReadAllBytes(ico);
    int n = d[4] | (d[5] << 8);
    for (int k = 0; k < n; k++) {
      int e = 6 + 16 * k;
      int w = d[e] == 0 ? 256 : d[e];
      int len = BitConverter.ToInt32(d, e + 8), off = BitConverter.ToInt32(d, e + 12);
      if (w == size && d[off] == 0x89) { byte[] r = new byte[len]; Array.Copy(d, off, r, 0, len); return r; }
    }
    throw new Exception(ico + " has no " + size + " px PNG image");
  }
}
'@

Stamp (Join-Path $root 'qt\bin\qml.exe') (Join-Path $root 'qt\bin\Hourglass.exe') 'Hourglass'
$window = Join-Path $root 'qt\bin\Hourglass.exe'
if (Test-Path $window) {
  [HgIconName]::Add($window)
  [HgIconName]::ReplaceQtLogo($window, [HgIconName]::IcoPng($icon, 48))
  Write-Host "Gave $window's windows the hourglass icon"
}
Stamp (Join-Path $root 'node\node.exe') (Join-Path $root 'node\hourglassd.exe') 'Hourglass'
