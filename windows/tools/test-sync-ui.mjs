// Windows QML contract checks. Uses a disposable HTTP fixture, never an install.
// Run: node windows/tools/test-sync-ui.mjs [path/to/qmltestrunner.exe]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "win32") throw new Error("These path checks require Windows Qt.");
const root = resolve(import.meta.dirname, "../..");
const temp = await mkdtemp(join(tmpdir(), "hg-sync-qml-"));
let reads, posted, commands, releaseAt;
const pair = () => ({ id: "pair", local: "C:\\Temp\\Studio #100%", folder_id: "existing",
  folder_path: "Drive/Studio", state: Date.now() >= releaseAt ? "syncing" : "paused",
  reason: "mass_delete", last_sync: 1, pending: 6, delete_count: 6, delete_side: "Drive",
  errors: [{ path: "sample.txt", error: "Test error" }] });
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  let out = {};
  if (req.url === "/test/reset") { reads = 0; posted = []; commands = []; releaseAt = Infinity; }
  else if (req.url === "/test/inspect") out = { reads, posted, commands };
  else if (req.url === "/api/syncfolders" && req.method === "GET") { reads++; out = [pair()]; }
  else if (req.url === "/api/syncfolders" && req.method === "POST") {
    posted.push(body);
    await new Promise(r => setTimeout(r, 400));
    out = pair();
  } else if (req.url.startsWith("/api/syncfolders/pair/")) {
    commands.push(req.url.split("/").at(-1));
    releaseAt = Date.now() + 22000;
    out = pair();
  } else if (req.url === "/api/folders") out = [{ id: "existing", name: "Studio" }];
  else if (req.url === "/api/actions/list_drive") out = { path: [], folders: [], files: [], courses: [] };
  else if (req.url === "/api/drive/usage") out = { total: 100, free: 100, used: 0, mine: 0, usable: 100, max_file: 100 };
  else if (req.url === "/api/shares") out = [];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(out));
});
let runner;
try {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const source = await readFile(join(root, "windows/app/tests/tst_FolderSync.qml"), "utf8");
  await writeFile(join(temp, "tst_FolderSync.qml"), source.replace("http://127.0.0.1:0", `http://127.0.0.1:${server.address().port}`));
  await mkdir(join(temp, "roaming"));
  await mkdir(join(temp, "local"));
  runner = spawn(process.argv[2] || "C:/Qt/6.8.3/msvc2022_64/bin/qmltestrunner.exe",
    ["-platform", "offscreen", "-import", join(root, "windows/app"), "-input", temp, "-o", `${join(temp, "results.txt")},txt`], {
      env: { ...process.env, APPDATA: join(temp, "roaming"), LOCALAPPDATA: join(temp, "local"), QT_QUICK_CONTROLS_STYLE: "Basic" },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
  runner.stdout.pipe(process.stdout);
  runner.stderr.pipe(process.stderr);
  const timeout = setTimeout(() => runner.kill(), 60000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      runner.on("error", reject);
      runner.on("exit", code => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(timeout);
    console.log(await readFile(join(temp, "results.txt"), "utf8").catch(() => "Qt did not create a result log."));
  }
} finally {
  runner?.kill();
  await new Promise(r => server.close(r));
  await rm(temp, { recursive: true, force: true, maxRetries: 5 });
}
