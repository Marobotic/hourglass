#!/usr/bin/env node
// Hourglass server: source of truth for sync, REST for the apps, MCP for AIs.
//   HOURGLASS_DATA   data dir (default ./data)
//   HOURGLASS_PORT   default 8930
//   HOURGLASS_HOST   default 127.0.0.1 (put nginx/Caddy in front for TLS)
//   HOURGLASS_URL    public base URL, used in openapi.json
//   MARO_ACCOUNT_URL the Jukebox server whose accounts sign in here
//                    (default http://127.0.0.1:8900)
//   MARO_CACHE_DIR   its data dir, for songs used as ringtones
//                    (default /var/lib/maro-cache)
//   HOURGLASS_ASSISTANT_*  the in-app assistant (opencode); see assistant.js
//
// Accounts: sign in with the Jukebox email and password; its session is
// the bearer here too. Each account has its own data; the account named in
// <data>/owner keeps the top-level data, which the legacy token also opens.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm, statfs } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { Store } from "../core/node/store.js";
import { Service } from "../core/node/service.js";
import { createHandler, openApi, VERSION } from "./app.js";
import { makeClip } from "./sounds.js";
import { createAssistant } from "./assistant.js";
import { createShares } from "./share.js";
import { createVersions, isText, lineDiff, whoOf } from "./versions.js";
import { createRingRoutes } from "./ring.js";

const dataDir = resolve(process.env.HOURGLASS_DATA || join(import.meta.dirname, "data"));
const driveDir = process.env.HOURGLASS_DRIVE_DIR ? resolve(process.env.HOURGLASS_DRIVE_DIR) : null;
const port = Number(process.env.HOURGLASS_PORT || 8930);
const host = process.env.HOURGLASS_HOST || "127.0.0.1";
const maroUrl = (process.env.MARO_ACCOUNT_URL || "http://127.0.0.1:8900").replace(/\/+$/, "");
const maroDir = process.env.MARO_CACHE_DIR || "/var/lib/maro-cache";
const MAX_UPLOAD = 40 * 1024 * 1024;
// One Drive upload. Default 1 GB or HOURGLASS_MAX_FILE; nginx's
// client_max_body_size for /hourglass/ must be a little over this.
const MAX_FILE = Number(process.env.HOURGLASS_MAX_FILE || (1024 * 1024 * 1024));
const TOO_BIG = `That file is over ${Math.round(MAX_FILE / (1024 * 1024))} MB, the most one upload can be.`;
// Kept free on the storage target: uploads that would go below this are refused.
const DISK_RESERVE = 2 * 1024 * 1024 * 1024;
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
  t.ringRoute = createRingRoutes(t);
  if (t.aiKey) aiKeys.set(t.aiKey, key || owner);
  // The assistant's own key, so its MCP calls work straight after a restart.
  const ak = existsSync(join(dir, "assistant_key")) ? readFileSync(join(dir, "assistant_key"), "utf8").trim() : "";
  if (ak) { t.assistantKey = ak; aiKeys.set(ak, key || owner); }
  t.handler = createHandler({ store, service, token: null, icalToken: t.icalKey, publicUrl: process.env.HOURGLASS_URL, guard: t.ringGuard,
    extra: async (req, res, url, path) => (await t.ringRoute(req, res, url, path)) || (await driveRoutes(t, req, res, url, path)) || (await shares.routes(t, req, res, url, path)) || ringtoneRoutes(t, req, res, url, path) });
  shares.load(t);
  tenants.set(key, t);
  return t;
}

const assistant = createAssistant({
  rootDir: resolve(import.meta.dirname, ".."),
  publicUrl: process.env.HOURGLASS_URL,
  registerKey: (key, t) => aiKeys.set(key, t.email),
  // Attachments are Drive files: their bytes (drivePath is defined further down).
  filePath: (t, id) => drivePath(t, id),
});

// Drive links (marobotic.dev/hourglass/drive/<token>). The drive helpers below are
// reached through arrows: they are defined further down.
const shares = createShares({
  publicUrl: process.env.HOURGLASS_URL,
  drivePath: (t, id) => drivePath(t, id),
  thumbnail: (t, row) => thumbnail(t, row),
  canThumb: (f) => canThumb(f),
  thumbMaxImage: 40 * 1024 * 1024,
});

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
  // Only the account server saying no (401/403) signs a session out; it being
  // down or slow is a 503, never "unauthorized" cached for everyone.
  const down = () => {
    if (hit?.email) return hit.email; // keep a known session
    throw Object.assign(new Error("The account server is not answering. Try again in a moment."), { status: 503 });
  };
  try {
    const r = await fetch(`${maroUrl}/account`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const o = await r.json();
      email = String(o.account?.email || o.email || "").toLowerCase() || null;
    } else if (r.status !== 401 && r.status !== 403) return down();
  } catch {
    return down();
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

// Sign-in goes to the Jukebox server: same accounts, same sessions.
// Forgot and reset (a link by email) go there too.
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

// Songs come from the Jukebox cache, by video id or Spotify track id.
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

// --- drive -------------------------------------------------------------------------

// HOURGLASS_DRIVE_DIR is a mount (rclone on Google Drive). If the mount is
// down, the folder underneath is an empty local one: files saved there would
// vanish behind the mount when it comes back. The mount's root holds a
// .hourglass-drive marker, so a missing marker means "down", and writes wait.
const driveOnline = () => !driveDir || existsSync(join(driveDir, ".hourglass-drive"));
const OFFLINE = "Drive storage is offline for a moment. Try again in a minute.";

const drivePath = (t, id) => {
  if (driveDir) {
    const userSubdir = t.email === owner ? "owner" : sha(t.email).slice(0, 24);
    return join(driveDir, userSubdir, "drive", id);
  }
  return join(t.dir, "drive", id);
};

const versions = createVersions({ drivePath });

// Background backfill for existing files missing sha256.
// One file at a time, only while driveOnline() is true.
// Retries after a delay if a file fails or Drive is offline.
const BACKFILL_RETRY_MS = Number(process.env.HOURGLASS_BACKFILL_RETRY_MS || 5000);
const backfillFailed = new Map(); // fileId -> timestamp of failure
const backfillLogged = new Set(); // each failing file is logged once, not on every retry
let backfillRunning = false;
let backfillTimeout = null;

async function hashFileAsync(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function scheduleBackfill(delayMs = BACKFILL_RETRY_MS) {
  if (backfillTimeout) clearTimeout(backfillTimeout);
  backfillTimeout = setTimeout(() => {
    backfillTimeout = null;
    runBackfill().catch((err) => console.error("Backfill error:", err));
  }, delayMs);
  if (backfillTimeout?.unref) backfillTimeout.unref();
}

async function runBackfill() {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    while (true) {
      if (!driveOnline()) {
        scheduleBackfill();
        return;
      }

      let nextTarget = null;
      const now = Date.now();
      for (const t of tenants.values()) {
        for (const f of t.store.all("files")) {
          if (!f.deleted && !f.sha256) {
            const lastFailed = backfillFailed.get(f.id);
            if (lastFailed && now - lastFailed < BACKFILL_RETRY_MS) {
              continue;
            }
            nextTarget = { t, file: f };
            break;
          }
        }
        if (nextTarget) break;
      }

      if (!nextTarget) {
        let earliestRetry = Infinity;
        let hasPending = false;
        for (const t of tenants.values()) {
          for (const f of t.store.all("files")) {
            if (!f.deleted && !f.sha256) {
              const lastFailed = backfillFailed.get(f.id) || 0;
              const retryAt = lastFailed + BACKFILL_RETRY_MS;
              earliestRetry = Math.min(earliestRetry, Math.max(0, retryAt - Date.now()));
              hasPending = true;
            }
          }
        }
        if (hasPending) {
          scheduleBackfill(Math.max(100, earliestRetry));
        }
        return;
      }

      const { t, file } = nextTarget;
      const filePath = drivePath(t, file.id);
      try {
        if (!existsSync(filePath)) {
          throw new Error(`File ${file.id} does not exist at ${filePath}`);
        }
        const sha256 = await hashFileAsync(filePath);
        backfillFailed.delete(file.id);
        backfillLogged.delete(file.id);
        t.store.upsert("files", { id: file.id, sha256 });
      } catch (e) {
        if (!backfillLogged.has(file.id)) console.error(`Backfill failed for file ${file.id}:`, e.message);
        backfillLogged.add(file.id);
        backfillFailed.set(file.id, Date.now());
        scheduleBackfill();
        return;
      }

      await new Promise((r) => setImmediate(r));
    }
  } finally {
    backfillRunning = false;
  }
}
runBackfill().catch((e) => console.error("Backfill startup error:", e));

// Drop the bytes (and preview, and old versions) of files deleted here or by a device's sync.
// The Drive folder is a network mount, where a call can stall for seconds: the
// removes run off the main thread, once per deleted file, so a slow one never
// holds up other requests.
const swept = new Set(); // "<dir>/<file id>" already removed
function sweepDrive(t) {
  for (const f of t.store.all("files", { withDeleted: true })) {
    const key = `${t.dir}/${f.id}`;
    if (!f.deleted || swept.has(key)) continue;
    swept.add(key);
    Promise.all([rm(drivePath(t, f.id), { force: true }), rm(thumbPath(t, f.id), { force: true }), rm(thumbPath(t, f.id, true), { force: true }), versions.remove(t, f.id)]).catch(() => swept.delete(key));
  }
}

// A small square JPEG of a picture, or of a video's first second, for the
// apps' file lists: they show this instead of downloading the file itself.
// Made by ffmpeg on first ask and kept until the file changes. ?size=big is
// a 480 px one for the gallery views' big tiles.
const THUMB = 144;
const THUMB_BIG = 480;
const thumbPath = (t, id, big) => join(t.dir, "thumbs", big ? `${id}-${THUMB_BIG}.jpg` : `${id}.jpg`);
const thumbing = new Map(); // path -> promise, one ffmpeg per file at a time
const canThumb = (f) => (/^image\//.test(f.mime) && !/svg/.test(f.mime)) || /^video\//.test(f.mime);

// The droplet has 2 GB of RAM for everything: previews are made one at a time,
// on one thread, and a picture so big that decoding it would take hundreds of
// MB gets none (the apps show its icon).
const THUMB_MAX_IMAGE = 40 * 1024 * 1024;
let thumbQueue = Promise.resolve();
function oneAtATime(job) {
  const run = thumbQueue.then(job, job);
  thumbQueue = run.catch(() => {});
  return run;
}

function ffmpegFrame(src, out, seek, side = THUMB) {
  return oneAtATime(() => new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-nostdin", "-v", "error", "-threads", "1", ...(seek ? ["-ss", "1"] : []), "-i", src, "-frames:v", "1", "-threads", "1",
      "-vf", `scale=${side}:${side}:force_original_aspect_ratio=increase,crop=${side}:${side}`, "-q:v", "5", "-y", out];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const kill = setTimeout(() => p.kill("SIGKILL"), 30000);
    p.stderr.on("data", (c) => (err += c));
    p.on("error", (e) => { clearTimeout(kill); reject(e); });
    p.on("close", (code) => {
      clearTimeout(kill);
      code === 0 && existsSync(out) && statSync(out).size > 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || `ffmpeg exited ${code}`));
    });
  }));
}

async function thumbnail(t, row, big) {
  const src = drivePath(t, row.id);
  const out = thumbPath(t, row.id, big);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return out;
  if (!thumbing.has(out)) {
    thumbing.set(out, (async () => {
      mkdirSync(join(t.dir, "thumbs"), { recursive: true });
      const tmp = out + ".part.jpg";
      const video = /^video\//.test(row.mime);
      try {
        // A video shorter than a second has nothing at 1 s: take its first frame.
        const side = big ? THUMB_BIG : THUMB;
        await ffmpegFrame(src, tmp, video, side).catch((e) => (video ? ffmpegFrame(src, tmp, false, side) : Promise.reject(e)));
        renameSync(tmp, out);
      } finally {
        rmSync(tmp, { force: true });
      }
      return out;
    })().finally(() => thumbing.delete(out)));
  }
  return thumbing.get(out);
}

// The disks are asked at most every 30 s (the mount asks Google, which can be
// slow) and never on the main thread; every app with Drive open asks often.
let disks = null; // { at, total, free, room }
let disksAsking = null;
async function readDisks(t) {
  if (disks && Date.now() - disks.at < 30_000) return disks;
  disksAsking ??= (async () => {
    try {
      const s = await statfs(driveDir || t.dir);
      // rclone writes an upload to the droplet's disk before sending it to Google,
      // so the droplet needs room for it too.
      const local = await statfs(t.dir);
      const free = s.bavail * s.bsize;
      disks = { at: Date.now(), total: s.blocks * s.bsize, free, room: Math.min(free, local.bavail * local.bsize) };
      return disks;
    } finally {
      disksAsking = null;
    }
  })();
  return disksAsking;
}

async function diskUsage(t) {
  const { total, free, room } = await readDisks(t);
  const files = t.store.all("files");
  // Old versions take room too.
  const mine = files.reduce((n, f) => n + (f.size || 0), 0) + versions.bytes(t, files.map((f) => f.id));
  return { total, free, used: total - free, mine, usable: Math.max(0, room - DISK_RESERVE), max_file: MAX_FILE };
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4",
  zip: "application/zip", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const mimeOf = (name) => MIME[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";

async function driveRoutes(t, req, res, url, path) {
  const m = req.method;
  // Any change may delete files (a row, a folder, a sync): drop their bytes after.
  if (m !== "GET") res.on("finish", () => sweepDrive(t));
  if (path === "/api/drive/usage" && m === "GET") return send(res, 200, await diskUsage(t)), true;
  if (path === "/api/files/upload" && m === "POST") {
    const name = (url.searchParams.get("name") || "file").replace(/[\\/]/g, "_").trim().slice(0, 200) || "file";
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_FILE) return send(res, 413, { error: TOO_BIG }), true;
    if (!driveOnline()) return send(res, 503, { error: OFFLINE }), true;
    if (declared && declared > (await diskUsage(t)).usable) return send(res, 507, { error: "Not enough space left on the server." }), true;
    const folder = url.searchParams.get("folder") || null;
    if (folder && !t.store.get("folders", folder)) return send(res, 400, { error: "no folder with that id" }), true;
    const id = crypto.randomUUID();
    const target = drivePath(t, id);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = target + ".part";
    let size = 0;
    const hash = createHash("sha256");
    try {
      await pipeline(req, async function* (src) {
        for await (const c of src) {
          size += c.length;
          if (size > MAX_FILE) throw Object.assign(new Error(TOO_BIG), { status: 413 });
          hash.update(c);
          yield c;
        }
      }, createWriteStream(tmp));
    } catch (e) {
      rmSync(tmp, { force: true });
      throw Object.assign(e, { status: e.status || 400 });
    }
    if (!size) {
      rmSync(tmp, { force: true });
      return send(res, 400, { error: "empty file" }), true;
    }
    renameSync(tmp, drivePath(t, id));
    const course = url.searchParams.get("course") || null;
    const sha256 = hash.digest("hex");
    const row = t.store.upsert("files", { id, name, folder_id: course ? null : folder, course_id: course, size, sha256, mime: url.searchParams.get("mime") || mimeOf(name), note_id: url.searchParams.get("note") || null });
    versions.started(t, id, whoOf(t, req), size);
    return send(res, 201, row), true;
  }
  // New contents for an existing file (it was edited on a device).
  const put = /^\/api\/files\/([0-9a-f-]{36})\/raw$/.exec(path);
  if (put && m === "PUT") {
    const row = t.store.get("files", put[1]);
    if (!row || row.deleted) return send(res, 404, { error: "not found" }), true;
    if (!driveOnline()) return send(res, 503, { error: OFFLINE }), true;
    const tmp = drivePath(t, row.id) + ".put";
    let size = 0;
    const hash = createHash("sha256");
    try {
      await pipeline(req, async function* (src) {
        for await (const c of src) {
          size += c.length;
          if (size > MAX_FILE) throw Object.assign(new Error(TOO_BIG), { status: 413 });
          hash.update(c);
          yield c;
        }
      }, createWriteStream(tmp));
    } catch (e) {
      rmSync(tmp, { force: true });
      throw Object.assign(e, { status: e.status || 400 });
    }
    const sha256 = hash.digest("hex");
    // The contents it had stay as a version.
    versions.replace(t, row, tmp, whoOf(t, req), { size });
    return send(res, 200, t.store.upsert("files", { id: row.id, size, sha256 })), true;
  }
  // Versions: the list (with who changed it and when), one's bytes, what
  // changed (text files), and putting one back.
  const ver = /^\/api\/files\/([0-9a-f-]{36})\/versions(?:\/([0-9a-f-]{36})(?:\/(raw|diff|restore))?)?$/.exec(path);
  if (ver) {
    const row = t.store.get("files", ver[1]);
    if (!row || row.deleted) return send(res, 404, { error: "not found" }), true;
    const [, , vid, what] = ver;
    if (!vid && m === "GET") return send(res, 200, versions.list(t, row)), true;
    const v = vid ? versions.get(t, row.id, vid) : null;
    if (!v || !existsSync(versions.path(t, row.id, vid))) return send(res, 404, { error: "That version is no longer kept." }), true;
    if (!driveOnline()) return send(res, 503, { error: OFFLINE }), true;
    if (what === "raw" && m === "GET") {
      const f = versions.path(t, row.id, vid);
      const stamp = new Date(v.at).toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
      const name = row.name.replace(/(\.[^.]*)?$/, (ext) => ` (${stamp})${ext}`);
      res.writeHead(200, {
        "content-type": row.mime || "application/octet-stream",
        "content-length": statSync(f).size,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "private, max-age=31536000, immutable",
      });
      createReadStream(f).pipe(res);
      return true;
    }
    if (what === "diff" && m === "GET") {
      // Against the current file, or another version (?with=<id>).
      const other = url.searchParams.get("with");
      const ov = other ? versions.get(t, row.id, other) : null;
      if (other && !ov) return send(res, 404, { error: "That version is no longer kept." }), true;
      const newer = other ? versions.path(t, row.id, other) : drivePath(t, row.id);
      const sizes = { before: v.size, after: other ? ov.size : row.size };
      if (!isText(row)) return send(res, 200, { kind: "binary", ...sizes }), true;
      if (sizes.before > 2 * 1048576 || sizes.after > 2 * 1048576) return send(res, 200, { kind: "binary", tooBig: true, ...sizes }), true;
      const [a, b] = await Promise.all([versions.readText(versions.path(t, row.id, vid)), versions.readText(newer)]);
      return send(res, 200, { kind: "text", ...sizes, ...lineDiff(a, b) }), true;
    }
    if (what === "restore" && m === "POST") {
      // What it has now becomes a version too: a restore loses nothing.
      const srcFile = versions.path(t, row.id, vid);
      const tmp = drivePath(t, row.id) + ".restore";
      let size = 0;
      const hash = createHash("sha256");
      try {
        await pipeline(createReadStream(srcFile), async function* (src) {
          for await (const c of src) {
            size += c.length;
            hash.update(c);
            yield c;
          }
        }, createWriteStream(tmp));
      } catch (e) {
        rmSync(tmp, { force: true });
        throw Object.assign(e, { status: 500 });
      }
      const sha256 = hash.digest("hex");
      versions.replace(t, row, tmp, whoOf(t, req), { size, restored_from: vid });
      return send(res, 200, t.store.upsert("files", { id: row.id, size, sha256 })), true;
    }
    return send(res, 405, { error: "method not allowed" }), true;
  }
  const th = /^\/api\/files\/([0-9a-f-]{36})\/thumb$/.exec(path);
  if (th && m === "GET") {
    const row = t.store.get("files", th[1]);
    if (!row || row.deleted || !existsSync(drivePath(t, row.id)) || !canThumb(row)) return send(res, 404, { error: "no preview" }), true;
    if (/^image\//.test(row.mime) && (row.size || 0) > THUMB_MAX_IMAGE) return send(res, 404, { error: "no preview" }), true;
    let f;
    try { f = await thumbnail(t, row, url.searchParams.get("size") === "big"); } catch { return send(res, 404, { error: "no preview" }), true; }
    // Which size this is: an app keeps a big one only when it really is big.
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": statSync(f).size, "cache-control": "private, max-age=300", "x-thumb-size": String(url.searchParams.get("size") === "big" ? THUMB_BIG : THUMB) });
    createReadStream(f).pipe(res);
    return true;
  }
  const raw = /^\/api\/files\/([0-9a-f-]{36})\/raw$/.exec(path);
  if (raw && m === "GET") {
    const row = t.store.get("files", raw[1]);
    const f = drivePath(t, raw[1]);
    if (row && !row.deleted && !driveOnline()) return send(res, 503, { error: OFFLINE }), true;
    if (!row || row.deleted || !existsSync(f)) return send(res, 404, { error: "not found" }), true;
    res.writeHead(200, {
      "content-type": row.mime || "application/octet-stream",
      "content-length": statSync(f).size,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "cache-control": "private, max-age=31536000, immutable",
    });
    createReadStream(f).pipe(res);
    return true;
  }
  return false;
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
    // A shared Drive link: no sign-in.
    if (path.startsWith("/drive/") && shares.publicRoute(req, res, path, url)) return;
    if (/^\/auth\/(login|register|forgot|reset)$/.test(path) && req.method === "POST") return await proxyAuth(req, res, path);
    // The page a password-reset email links to (marobotic.dev/hourglass/reset#<token>).
    if (path === "/reset" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY" });
      return res.end(readFileSync(join(import.meta.dirname, "reset.html")));
    }
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
    const clientTz = req.headers["x-timezone"] || req.headers["x-client-timezone"];
    if (clientTz) {
      try { t.service.ensureHomeClock(clientTz); } catch {}
    }
    if (path === "/api/account") return send(res, 200, { email: t.email || null });
    if (await assistant.routes(t, req, res, path)) return;
    const base = process.env.HOURGLASS_URL || `http://${req.headers.host}`;
    if (path === "/api/ai" && req.method === "GET") return send(res, 200, aiInfo(t, base));
    if (path === "/api/ai" && req.method === "POST") {
      newAiKey(t);
      return send(res, 200, aiInfo(t, base));
    }
    // Delete the link: the key stops working until a new one is made.
    if (path === "/api/ai" && req.method === "DELETE") {
      if (t.aiKey) aiKeys.delete(t.aiKey);
      t.aiKey = "";
      rmSync(join(t.dir, "ai_key"), { force: true });
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
