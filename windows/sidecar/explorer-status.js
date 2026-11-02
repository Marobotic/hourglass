import { spawn } from "node:child_process";
import { readdir, stat, writeFile, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export function explorerStatusEnabled(env = process.env, platform = process.platform) {
  return platform === "win32" && String(env.HOURGLASS_EXPLORER_STATUS || "off").toLowerCase() === "on";
}

export async function makeStatusListing(pair) {
  const synced = new Set([
    ...(pair.syncedFilePaths?.keys?.() || []),
    ...(pair.syncedFolderPaths?.keys?.() || []),
  ].map((path) => path.replaceAll("\\", "/")));
  const in_sync = [], not_in_sync = [], errors = [];
  const failed = new Set((pair.errors || []).map((item) => String(item.path || "").replaceAll("\\", "/").replace(/^\//, "").toLowerCase()));
  async function walk(dir, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, rel);
      else if (entry.isFile()) {
        (synced.has(rel) ? in_sync : not_in_sync).push(rel);
        if (failed.has(rel.toLowerCase())) errors.push(rel);
      }
    }
    if (prefix) (synced.has(prefix) ? in_sync : not_in_sync).push(prefix);
  }
  await walk(pair.local);
  return { in_sync, not_in_sync, ...(errors.length ? { errors } : {}) };
}

export function createExplorerStatus({ dataDir, sidecarDir = here, env = process.env, platform = process.platform, spawnImpl = spawn, logger = () => {} }) {
  if (!explorerStatusEnabled(env, platform)) return { enabled: false, register: async () => {}, status: async () => {}, unregister: async () => {} };
  const exe = join(sidecarDir, "..", "bin", "hourglass-shell.exe");
  const icon = join(sidecarDir, "..", "hourglass.ico");
  const registered = new Set();
  async function call(args) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout?.on("data", (b) => { out = (out + b).slice(-8192); });
      child.stderr?.on("data", (b) => { err = (err + b).slice(-8192); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(out) : reject(new Error(err.trim() || `hourglass-shell exited ${code}`)));
    });
  }
  async function register(pair) {
    try {
      const out = await call(["register", "--pair", pair.id, "--path", resolve(pair.local), "--name", pair.name || pair.folder_name || pair.id, "--icon", icon]);
      registered.add(pair.id);
      logger("Explorer sync root registered", pair.id, out.trim());
      return true;
    } catch (error) { logger("Explorer sync root skipped", pair.id, error.message); return false; }
  }
  async function status(pair) {
    if (!registered.has(pair.id)) return false;
    const json = join(dataDir, `explorer-status-${pair.id}-${randomUUID()}.json`);
    try {
      await writeFile(json, JSON.stringify(await makeStatusListing(pair)), "utf8");
      const out = await call(["status", "--pair", pair.id, "--path", resolve(pair.local), "--json", json]);
      logger("Explorer sync status updated", pair.id, out.trim());
      return true;
    } catch (error) { logger("Explorer sync status failed", pair.id, error.message); return false; }
    finally { await rm(json, { force: true }).catch(() => {}); }
  }
  async function unregister(pair) {
    const id = typeof pair === "string" ? pair : pair.id;
    if (!registered.has(id)) return true;
    try { await call(["unregister", "--pair", id]); registered.delete(id); return true; }
    catch (error) { logger("Explorer sync root unregister failed", typeof pair === "string" ? pair : pair.id, error.message); return false; }
  }
  return { enabled: true, register, status, unregister };
}
