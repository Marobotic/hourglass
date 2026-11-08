import { spawn } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// The picture on the clipboard, saved as a PNG for the window to attach (QML
// can read the clipboard's text, not its pictures). Resolves the file's path,
// or null when the clipboard holds no picture.
function run(cmd, args, { timeout = 8000 } = {}) {
  return new Promise(done => {
    let child;
    try { child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }); } catch { return done(null); }
    const timer = setTimeout(() => child.kill(), timeout);
    const chunks = [];
    child.stdout.on("data", c => chunks.push(c));
    child.on("error", () => { clearTimeout(timer); done(null); });
    child.on("close", code => { clearTimeout(timer); done(code === 0 ? Buffer.concat(chunks) : null); });
  });
}

// -Command takes no separate arguments (they are glued onto the script), so the path goes inside it.
const windowsScript = (file) => [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
  "$i = [System.Windows.Forms.Clipboard]::GetImage()",
  "if (-not $i) { exit 3 }",
  `$i.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
].join("; ");

export async function clipboardImage({ dir, platform = process.platform, name = `Pasted picture ${Date.now()}.png` }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  if (platform === "win32") {
    const ok = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-Command", windowsScript(file)]);
    return ok && statSync(file, { throwIfNoEntry: false })?.size ? file : null;
  }
  const png = (await run("wl-paste", ["--type", "image/png"])) || (await run("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]));
  if (!png || !png.length) return null;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, png);
  return file;
}

export function forgetClipboardImage(file) { try { rmSync(file, { force: true }); } catch {} }
