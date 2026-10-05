#!/usr/bin/env node
// Hourglass server: source of truth for sync, REST for the apps, MCP for AIs.
//   HOURGLASS_DATA   data dir (default ./data)
//   HOURGLASS_PORT   default 8930
//   HOURGLASS_HOST   default 127.0.0.1 (put nginx/Caddy in front for TLS)
//   HOURGLASS_URL    public base URL, used in openapi.json
//   MARO_ACCOUNT_URL the Omarchy Music server whose accounts sign in here
//                    (default http://127.0.0.1:8900)
//   MARO_CACHE_DIR   its data dir, for songs used as ringtones
//                    (default /var/lib/maro-cache)
//
// Accounts: sign in with the Omarchy Music email and password; its session is
// the bearer here too. Each account has its own data; the account named in
// <data>/owner keeps the top-level data, which the legacy token also opens.
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../core/node/store.js";
import { Service } from "../core/node/service.js";
import { createHandler, openApi, VERSION } from "./app.js";
import { makeClip } from "./sounds.js";

const dataDir = resolve(process.env.HOURGLASS_DATA || join(import.meta.dirname, "data"));
const port = Number(process.env.HOURGLASS_PORT || 8930);
const host = process.env.HOURGLASS_HOST || "127.0.0.1";
const maroUrl = (process.env.MARO_ACCOUNT_URL || "http://127.0.0.1:8900").replace(/\/+$/, "");
const maroDir = process.env.MARO_CACHE_DIR || "/var/lib/maro-cache";
const MAX_UPLOAD = 40 * 1024 * 1024;
const SONG_EXTS = [".m4a", ".opus", ".webm", ".mp3", ".ogg", ".aac", ".flac"];

function secret(dir, name) {
  const p = join(dir, name);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const s = randomBytes(24).toString("base64url");
  writeFileSync(p, s + "\n", { mode: 0o600 });
  return s;
}

const token = process.env.HOURGLASS_TOKEN || secret(dataDir, "token");
const owner = existsSync(join(dataDir, "owner")) ? readFileSync(join(dataDir, "owner"), "utf8").trim().toLowerCase() : "";
const sha = (s) => createHash("sha256").update(s).digest("hex");

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("file too large (40 MB max)"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// --- tenants ---------------------------------------------------------------

const tenants = new Map(); // email ("" = owner) -> tenant

// Personal AI keys: one per account, for ChatGPT, Claude, Gemini or any MCP
// client. The key opens that account's data, like a session that does not
// expire; making a new one turns the old one off.
const aiKeys = new Map(); // key -> email
const readKey = (dir) => (existsSync(join(dir, "ai_key")) ? readFileSync(join(dir, "ai_key"), "utf8").trim() : "");

function newAiKey(t) {
  if (t.aiKey) aiKeys.delete(t.aiKey);
  t.aiKey = "hg_" + randomBytes(24).toString("base64url");
  writeFileSync(join(t.dir, "ai_key"), t.aiKey + "\n", { mode: 0o600 });
  aiKeys.set(t.aiKey, t.email === owner ? "" : t.email);
  return t.aiKey;
}

function aiInfo(t, base) {
  return {
    key: t.aiKey || null,
    mcp_url: t.aiKey ? `${base}/mcp/${t.aiKey}` : null,
    openapi_url: `${base}/openapi.json`,
    actions_url: `${base}/api/actions`,
  };
}

function tenant(email) {
  const key = email === owner ? "" : email;
  let t = tenants.get(key);
  if (t) return t;
  const dir = key ? join(dataDir, "users", sha(key).slice(0, 24)) : dataDir;
  mkdirSync(join(dir, "sounds"), { recursive: true });
  if (key) writeFileSync(join(dir, "email"), key + "\n");
  const store = new Store(join(dir, "hourglass.db"));
  const service = new Service(store);
  t = { email: key || owner, dir, store, service, icalKey: secret(dir, "ical_key"), aiKey: readKey(dir) };
  if (t.aiKey) aiKeys.set(t.aiKey, key || owner);
  t.handler = createHandler({ store, service, token: null, icalToken: t.icalKey, publicUrl: process.env.HOURGLASS_URL, extra: (req, res, url, path) => ringtoneRoutes(t, req, res, url, path) });
  tenants.set(key, t);
  return t;
}

// Open every account once so iCal keys resolve.
tenant("");
for (const d of existsSync(join(dataDir, "users")) ? readdirSync(join(dataDir, "users")) : []) {
  const f = join(dataDir, "users", d, "email");
  if (existsSync(f)) tenant(readFileSync(f, "utf8").trim());
}

// --- sessions --------------------------------------------------------------

const sessions = new Map(); // sha256(session) -> {email, until}

async function sessionEmail(bearer) {
  const k = sha(bearer);
  const hit = sessions.get(k);
  if (hit && hit.until > Date.now()) return hit.email;
  let email = null;
  try {
    const r = await fetch(`${maroUrl}/account`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const o = await r.json();
      email = String(o.account?.email || o.email || "").toLowerCase() || null;
    }
  } catch {
    if (hit?.email) return hit.email; // account server briefly down: keep a known session
  }
  sessions.set(k, { email, until: Date.now() + (email ? 10 * 60_000 : 30_000) });
  return email;
}

function bearerOf(req) {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : String(req.headers["x-hourglass-token"] ?? "");
}

// "" for the legacy token (the owner), the account email, or null.
async function who(req) {
  const bearer = bearerOf(req);
  if (!bearer) return null;
  const a = Buffer.from(bearer);
  const b = Buffer.from(token);
  if (a.length === b.length && timingSafeEqual(a, b)) return "";
  if (aiKeys.has(bearer)) return aiKeys.get(bearer);
  return await sessionEmail(bearer);
}

// Sign-in goes to the Omarchy Music server: same accounts, same sessions.
async function proxyAuth(req, res, path) {
  const body = await readRaw(req, 4096);
  const r = await fetch(maroUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
    body: body.length ? body : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, r.status, { ok: false, error: out.error || "sign-in failed", retryIn: out.retryIn });
  if (!out.session) return send(res, 200, { ok: true });
  const email = String(out.account?.email || JSON.parse(body.toString() || "{}").email || "").toLowerCase();
  sessions.set(sha(out.session), { email, until: Date.now() + 10 * 60_000 });
  tenant(email);
  return send(res, 200, { ok: true, session: out.session, email });
}

// --- ringtones ---------------------------------------------------------------

const soundPath = (t, id) => join(t.dir, "sounds", `${id}.wav`);

// Drop the audio of ringtones deleted here or by a device's sync.
function sweepSounds(t) {
  for (const r of t.store.all("ringtones", { withDeleted: true })) if (r.deleted) rmSync(soundPath(t, r.id), { force: true });
}

async function addRingtone(t, input, fields, select) {
  const id = crypto.randomUUID();
  const tmp = soundPath(t, id) + ".part.wav";
  let clip;
  try {
    clip = await makeClip(input, tmp);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw Object.assign(new Error(`could not read that audio (${e.message})`), { status: 400 });
  }
  renameSync(tmp, soundPath(t, id));
  const row = t.store.upsert("ringtones", { ...fields, id, duration_s: clip.duration_s });
  if (select) t.service.setRingtone({ ringtone: id });
  return { ...row, selected: !!select };
}

// Songs come from the Omarchy Music cache, by video id or Spotify track id.
function songFile(id) {
  const dir = join(maroDir, "audio");
  const find = (x) => SONG_EXTS.map((e) => join(dir, x + e)).find((p) => existsSync(p) && statSync(p).size > 0);
  let file = find(id);
  if (!file) {
    try {
      const mapped = JSON.parse(readFileSync(join(maroDir, "map.json"), "utf8"))[id];
      if (mapped) file = find(mapped);
    } catch {}
  }
  return file;
}

async function ringtoneRoutes(t, req, res, url, path) {
  const m = req.method;
  if (path === "/api/sync" && m === "POST") {
    res.on("finish", () => sweepSounds(t));
    return false;
  }
  if (path === "/api/ringtones" && m === "GET") return send(res, 200, t.service.listRingtones());
  if (path === "/api/ringtones/upload" && m === "POST") {
    const body = await readRaw(req, MAX_UPLOAD);
    if (body.length < 1000) return send(res, 400, { error: "empty file" });
    const src = join(t.dir, "sounds", `upload-${randomBytes(6).toString("hex")}`);
    writeFileSync(src, body);
    try {
      const name = (url.searchParams.get("name") || "My ringtone").replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 80) || "My ringtone";
      return send(res, 201, await addRingtone(t, src, { name, kind: "upload" }, url.searchParams.get("select") === "1"));
    } finally {
      rmSync(src, { force: true });
    }
  }
  if (path === "/api/ringtones/song" && m === "POST") {
    const b = JSON.parse((await readRaw(req, 8192)).toString() || "{}");
    const songId = String(b.song_id || "");
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(songId)) return send(res, 400, { error: "song_id is required" });
    const select = b.select !== false;
    const same = t.store.all("ringtones").find((r) => r.song_id === songId);
    if (same) {
      if (select) t.service.setRingtone({ ringtone: same.id });
      return send(res, 200, { ...same, selected: select, existed: true });
    }
    const file = songFile(songId);
    if (!file) return send(res, 404, { error: "This song isn't saved on the server yet. Play it once, then try again." });
    const fields = { name: String(b.name || "Song").slice(0, 120), artist: b.artist ? String(b.artist).slice(0, 120) : null, kind: "song", song_id: songId };
    return send(res, 201, await addRingtone(t, file, fields, select));
  }
  const a = /^\/api\/ringtones\/([0-9a-f-]{36})\/audio$/.exec(path);
  if (a && m === "GET") {
    const row = t.store.get("ringtones", a[1]);
    const f = soundPath(t, a[1]);
    if (!row || row.deleted || !existsSync(f)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": "audio/wav", "content-length": statSync(f).size, "cache-control": "private, max-age=31536000, immutable" });
    createReadStream(f).pipe(res);
    return true;
  }
  const d = /^\/api\/ringtones\/([0-9a-f-]{36})$/.exec(path);
  if (d && m === "DELETE") {
    const out = t.service.removeRingtone({ ringtone_id: d[1] });
    sweepSounds(t);
    return send(res, 200, out);
  }
  return false;
}

// --- server ------------------------------------------------------------------

createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/health") return send(res, 200, { ok: true, name: "hourglass", version: VERSION });
    if (path === "/openapi.json") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(openApi(process.env.HOURGLASS_URL || `http://${req.headers.host}`)));
    }
    if (path === "/ical") {
      const t = [...tenants.values()].find((x) => x.icalKey === url.searchParams.get("key"));
      if (!t) return send(res, 403, { error: "bad key" });
      return t.handler(req, res);
    }
    if ((path === "/auth/login" || path === "/auth/register") && req.method === "POST") return await proxyAuth(req, res, path);
    // MCP with the key in the link, for apps that only take a URL (ChatGPT
    // and Claude connectors): https://.../hourglass/mcp/<key>
    const mk = /^\/mcp\/(hg_[A-Za-z0-9_-]{20,})$/.exec(path);
    if (mk) {
      if (!aiKeys.has(mk[1])) return send(res, 401, { error: "unknown or replaced key: make a new link in Hourglass settings" });
      req.url = "/mcp";
      return tenant(aiKeys.get(mk[1])).handler(req, res);
    }
    const email = await who(req);
    if (email === null) return send(res, 401, { error: "unauthorized" });
    if (path === "/auth/logout" && req.method === "POST") {
      sessions.delete(sha(bearerOf(req)));
      return await proxyAuth(req, res, path);
    }
    const t = tenant(email);
    if (path === "/api/account") return send(res, 200, { email: t.email || null });
    const base = process.env.HOURGLASS_URL || `http://${req.headers.host}`;
    if (path === "/api/ai" && req.method === "GET") return send(res, 200, aiInfo(t, base));
    if (path === "/api/ai" && req.method === "POST") {
      newAiKey(t);
      return send(res, 200, aiInfo(t, base));
    }
    return t.handler(req, res);
  } catch (e) {
    if (res.headersSent) return;
    if (!e.status) console.error(e);
    send(res, e.status ?? 502, { error: e.message });
  }
}).listen(port, host, () => {
  console.log(`hourglass ${VERSION} on http://${host}:${port} (data ${dataDir}, owner ${owner || "none"}, accounts via ${maroUrl})`);
});
