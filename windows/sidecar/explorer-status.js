import { spawn } from "node:child_process";
import { readdir, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export function explorerStatusEnabled(env = process.env, platform = process.platform) {
  return platform === "win32" && String(env.HOURGLASS_EXPLORER_STATUS || "on").toLowerCase() !== "off";
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
        const hasError = failed.has(rel.toLowerCase());
        (synced.has(rel) && !hasError ? in_sync : not_in_sync).push(rel);
        if (hasError) errors.push(rel);
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
  const connections = new Map();
  const statusQueues = new Map();
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
    const previous = statusQueues.get(pair.id) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => applyStatus(pair));
    statusQueues.set(pair.id, current);
    try { return await current; }
    finally { if (statusQueues.get(pair.id) === current) statusQueues.delete(pair.id); }
  }
  async function applyStatus(pair) {
    const connection = connections.get(pair.id);
    if (!registered.has(pair.id) || !connection) return false;
    const json = join(tmpdir(), `hourglass-explorer-status-${pair.id}-${randomUUID()}.json`);
    const requestId = randomUUID();
    const request = join(connection.controlDir, "request.json");
    const response = join(connection.controlDir, `response-${requestId}.json`);
    try {
      await writeFile(json, JSON.stringify(await makeStatusListing(pair)), "utf8");
      await writeFile(request, JSON.stringify({ id: requestId, json }), "utf8");
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          const result = JSON.parse(await readFile(response, "utf8"));
          if (!result.ok) throw new Error(result.errors?.join("; ") || "Cloud Files status update failed");
          logger("Explorer sync status updated", pair.id, JSON.stringify(result));
          return true;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Cloud Files status request timed out");
    } catch (error) { logger("Explorer sync status failed", pair.id, error.message); return false; }
    finally { await Promise.all([rm(json, { force: true }), rm(response, { force: true })]); }
  }
  async function connect(pair) {
    if (!registered.has(pair.id)) return false;
    const current = connections.get(pair.id);
    if (current?.child && current.child.exitCode === null && current.child.signalCode === null) return current.ready;
    return new Promise((resolve, reject) => {
      const controlDir = join(tmpdir(), `hourglass-cloudfiles-${pair.id}-${randomUUID()}`);
      const child = spawnImpl(exe, ["serve", "--root", resolvePath(pair.local), "--pair", pair.id, "--control", controlDir], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let markReady;
      const ready = new Promise((resolveReady) => { markReady = resolveReady; });
      connections.set(pair.id, { child, controlDir, ready });
      mkdir(controlDir, { recursive: true }).catch((error) => logger("Explorer control directory failed", pair.id, error.message));
      let stdout = "", stderr = "", settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; markReady(false); child.kill(); reject(new Error("Cloud Files provider connection timed out")); }
      }, 10000);
      timeout.unref?.();
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split(/\r?\n/)) {
          try {
            if (JSON.parse(line).connected === true && !settled) {
              settled = true; clearTimeout(timeout); markReady(true); resolve(true);
            }
          } catch {}
        }
        stdout = stdout.slice(-4096);
      });
      child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
      child.once("error", (error) => {
        connections.delete(pair.id);
        if (!settled) { settled = true; clearTimeout(timeout); markReady(false); reject(error); }
      });
      child.once("close", (code) => {
        if (connections.get(pair.id)?.child === child) connections.delete(pair.id);
        if (!settled) { settled = true; clearTimeout(timeout); markReady(false); reject(new Error(stderr.trim() || `provider helper exited ${code} before connecting`)); }
        else logger("Explorer provider disconnected", pair.id, code);
        rm(controlDir, { recursive: true, force: true }).catch(() => {});
      });
    }).catch((error) => { logger("Explorer provider connection failed", pair.id, error.message); return false; });
  }
  function resolvePath(path) { return resolve(path); }
  async function disconnect(pair) {
    const id = typeof pair === "string" ? pair : pair.id;
    const connection = connections.get(id);
    if (!connection) return true;
    const child = connection.child;
    return new Promise((resolve) => {
      child.once("close", () => resolve(true));
      child.kill();
      setTimeout(async () => { await rm(connection.controlDir, { recursive: true, force: true }); resolve(false); }, 5000).unref?.();
    });
  }
  process.once("exit", () => {
    for (const { child } of connections.values()) child.kill();
  });
  async function unregister(pair) {
    const id = typeof pair === "string" ? pair : pair.id;
    if (!await disconnect(id)) {
      logger("Explorer provider did not stop before unregister", id);
      return false;
    }
    if (!registered.has(id)) return true;
    try { await call(["unregister", "--pair", id]); registered.delete(id); return true; }
    catch (error) { logger("Explorer sync root unregister failed", typeof pair === "string" ? pair : pair.id, error.message); return false; }
  }
  return { enabled: true, register, connect, disconnect, status, unregister };
}
