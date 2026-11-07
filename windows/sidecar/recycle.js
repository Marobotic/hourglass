// Files and empty folders to the Recycle Bin (Windows), for synced folders.
import { spawn } from "node:child_process";

// The script goes in on stdin (no command-line length limit for many paths).
// PowerShell's "-Command -" runs a multi-line block only once a blank line
// ends it: without one, input that ends inside the block is dropped and
// nothing is deleted, with exit code 0. So it is one try block, then a blank line.
export function recycleScript(paths) {
  const encodedPaths = Buffer.from(JSON.stringify(paths), "utf8").toString("base64");
  return `try {
  $ErrorActionPreference = 'Stop'
  Add-Type -AssemblyName Microsoft.VisualBasic
  $paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPaths}')) | ConvertFrom-Json
  $files = @($paths | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Container) })
  $folders = @($paths | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Sort-Object { $_.Length } -Descending)
  foreach ($path in $files) {
    if (Test-Path -LiteralPath $path) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile([string]$path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    }
  }
  foreach ($path in $folders) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if (Get-ChildItem -LiteralPath $path -Force | Select-Object -First 1) { throw "Folder is not empty: $path" }
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory([string]$path, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

`;
}

export async function moveFilesToRecycleBin(paths) {
  if (!paths.length) return;
  if (process.platform !== "win32") throw new Error("Recycle Bin sync is available on Windows only.");
  const command = recycleScript(paths);
  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.once("error", reject);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "Could not move the files to the Recycle Bin."));
    });
    child.stdin.end(command, "utf8");
  });
}
