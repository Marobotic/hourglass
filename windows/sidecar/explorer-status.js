import { spawn } from "node:child_process";
import { readdir, writeFile, readFile, rm, mkdir, rename } from "node:fs/promises";
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

export function createExplorerStatus({ dataDir = tmpdir(), sidecarDir = here, env = process.env, platform = process.platform, spawnImpl = spawn, logger = () => {} }) {
  if (!explorerStatusEnabled(env, platform)) return { enabled: false, register: async () => false, connect: async () => false, status: async () => false, unregister: async () => true, cleanupStale: async () => false, registerNavigation: async () => false, shutdown: async () => {} };
  const exe = join(sidecarDir, "..", "bin", "hourglass-shell.exe");
  const icon = join(sidecarDir, "..", "hourglass.ico");
  const registered = new Map();
  let connection = null, signature = "", starting = null, stopping = false;
  let requestQueue = Promise.resolve();
  const errorCachePath = join(dataDir, "explorer-status-errors.json");
  const errorCache = readFile(errorCachePath, "utf8").then((body) => JSON.parse(body)).catch(() => ({}));
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
      registered.set(pair.id, pair);
      logger("Explorer sync root registered", pair.id, out.trim());
      return true;
    } catch (error) { logger("Explorer sync root skipped", pair.id, error.message); return false; }
  }
  async function cleanupStale() {
    try { const out = await call(["cleanup-stale"]); logger("Explorer stale namespace cleanup complete", out.trim()); return true; }
    catch (error) { logger("Explorer stale namespace cleanup failed", error.message); return false; }
  }
  async function registerNavigation(path) {
    try { const out = await call(["navigation", "--path", resolve(path), "--icon", icon]); logger("Hourglass navigation entry registered", resolve(path), out.trim()); return true; }
    catch (error) { logger("Hourglass navigation entry registration failed", error.message); return false; }
  }
  async function status(pair) {
    const current = requestQueue.catch(() => {}).then(() => applyStatus(pair));
    requestQueue = current;
    return current;
  }
  async function applyStatus(pair) {
    if (!registered.has(pair.id) || !await connect(pair)) return false;
    const active = connection;
    if (!active) return false;
    const json = join(tmpdir(), `hourglass-explorer-status-${pair.id}-${randomUUID()}.json`);
    const requestId = randomUUID();
    const request = join(active.controlDir, "request.json");
    const response = join(active.controlDir, `response-${requestId}.json`);
    try {
      const listing = await makeStatusListing(pair);
      const cache = await errorCache;
      const currentErrors = listing.errors || [];
      const currentSet = new Set(currentErrors.map((path) => path.toLowerCase()));
      const existing = new Set([...listing.in_sync, ...listing.not_in_sync].map((path) => path.toLowerCase()));
      const clearErrors = (cache[pair.id] || []).filter((path) => existing.has(path.toLowerCase()) && !currentSet.has(path.toLowerCase()));
      if (clearErrors.length) listing.clear_errors = clearErrors;
      await writeFile(json, JSON.stringify(listing), "utf8");
      await writeFile(request, JSON.stringify({ pair: pair.id, id: requestId, json }), "utf8");
      const requestTimeout = Math.max(30000, Number(env.HOURGLASS_EXPLORER_STATUS_TIMEOUT_MS) || 600000);
      const deadline = Date.now() + requestTimeout;
      while (Date.now() < deadline) {
        try {
          const result = JSON.parse(await readFile(response, "utf8"));
          if (!result.ok) throw new Error(result.errors?.join("; ") || "Cloud Files status update failed");
          cache[pair.id] = currentErrors;
          const cacheTemp = `${errorCachePath}.${randomUUID()}.tmp`;
          await writeFile(cacheTemp, JSON.stringify(cache), "utf8");
          await rename(cacheTemp, errorCachePath);
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
  function rootsSignature() {
    return JSON.stringify([...registered.values()].map((p) => [p.id, resolve(p.local)]).sort((a, b) => a[0].localeCompare(b[0])));
  }
  async function stopServe() {
    const old = connection;
    connection = null;
    if (!old) return;
    await new Promise((done) => {
      if (old.child.exitCode !== null || old.child.signalCode !== null) return done();
      const timer = setTimeout(done, 5000); timer.unref?.();
      old.child.once("close", () => { clearTimeout(timer); done(); });
      old.child.kill();
    });
    await rm(old.controlDir, { recursive: true, force: true }).catch(() => {});
  }
  async function startServe() {
    if (stopping || !registered.size) return false;
    const wanted = rootsSignature();
    if (connection && signature === wanted && connection.child.exitCode === null && connection.child.signalCode === null) return connection.ready;
    if (starting) return starting;
    starting = (async () => {
      await stopServe();
      const controlDir = join(tmpdir(), `hourglass-cloudfiles-${randomUUID()}`);
      await mkdir(controlDir, { recursive: true });
      const rootsFile = join(controlDir, "roots.json");
      await writeFile(rootsFile, JSON.stringify([...registered.values()].map((p) => ({ pair: p.id, path: resolve(p.local) }))), "utf8");
      if (!registered.size || stopping) return false;
      const runningSignature = rootsSignature();
      let child;
      try { child = spawnImpl(exe, ["serve", "--roots", rootsFile, "--control", controlDir], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
      catch (error) { await rm(controlDir, { recursive: true, force: true }); throw error; }
      let markReady, stdout = "", stderr = "", settled = false;
      const ready = new Promise((resolveReady) => { markReady = resolveReady; });
      const current = { child, controlDir, ready };
      connection = current; signature = runningSignature;
      const timeout = setTimeout(() => { if (!settled) { settled = true; markReady(false); child.kill(); } }, 10000);
      timeout.unref?.();
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split(/\r?\n/)) try { if (JSON.parse(line).connected === true && !settled) { settled = true; clearTimeout(timeout); markReady(true); } } catch {}
        stdout = stdout.slice(-4096);
      });
      child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
      child.once("error", (error) => { if (connection === current) connection = null; if (!settled) { settled = true; clearTimeout(timeout); markReady(false); } logger("Explorer helper launch failed", error.message); });
      child.once("close", (code) => {
        if (connection === current) connection = null;
        if (!settled) { settled = true; clearTimeout(timeout); markReady(false); }
        logger("Explorer provider exited", code, stderr.trim());
        rm(controlDir, { recursive: true, force: true }).catch(() => {});
        if (!stopping && registered.size) { const retry = setTimeout(() => connect([...registered.values()][0]), 1000); retry.unref?.(); }
      });
      const ok = await ready;
      clearTimeout(timeout);
      if (!ok) throw new Error(stderr.trim() || "Cloud Files provider did not connect");
      logger("Explorer provider connected", registered.size, "roots");
      return true;
    })().catch(async (error) => { logger("Explorer provider connection failed", error.message); await stopServe(); return false; }).finally(() => { starting = null; });
    return starting;
  }
  async function connect(pair) {
    if (!registered.has(pair.id)) return false;
    return startServe();
  }
  async function unregister(pair) {
    const id = typeof pair === "string" ? pair : pair.id;
    await stopServe();
    try {
      if (registered.has(id)) await call(["unregister", "--pair", id]);
      registered.delete(id);
      if (registered.size) await startServe();
      return true;
    } catch (error) { logger("Explorer sync root unregister failed", id, error.message); return false; }
  }
  async function shutdown() { stopping = true; await stopServe(); }
  process.once("exit", () => { stopping = true; connection?.child.kill(); });
  return { enabled: true, register, connect, status, unregister, cleanupStale, registerNavigation, shutdown };
}
