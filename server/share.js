// Drive links: "anyone with the link can view" (or view and download) for one
// file or a whole folder, like Google Drive. A link opens a page at
//   https://marobotic.dev/hourglass/drive/<token>
// that shows the file (pictures, video, audio, PDF, text) or the folder's
// contents, with no sign-in. One link per file or folder; changing its access
// keeps the link, "Stop sharing" kills it.
//
// Links live in the account's own folder (shares.json), never in the synced
// tables: the apps ask the server for them. The server keeps token -> account
// in memory so a public request finds its file without opening every account.
//
// Safety: the token is 128 random bits; a folder link opens only that folder
// and what is under it; files that a browser would run (HTML, SVG, XML,
// scripts) are never shown inline, and everything served carries nosniff and
// a sandbox CSP, so a shared file can't act as marobotic.dev.
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ACCESS = ["view", "download"];
const EXPIRY_DAYS = [1, 7, 30];
const PREVIEW_TEXT = 512 * 1024; // text files show inline up to this size
const ACTIVE = /html|svg|xml|javascript|ecmascript|x-sh|php/i;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function size(n) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  n = Number(n) || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i && n < 10 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
}

const kindOf = (f) => {
  const m = String(f.mime || "");
  if (/^image\//.test(m) && !/svg/.test(m)) return "image";
  if (/^video\//.test(m)) return "video";
  if (/^audio\//.test(m)) return "audio";
  if (m === "application/pdf") return "pdf";
  if (/^text\/(plain|markdown|csv)/.test(m) || /\.(txt|md|csv|log|json)$/i.test(f.name)) return "text";
  return "file";
};

export function createShares({ publicUrl = "", drivePath, thumbnail, canThumb, thumbMaxImage, log = console.log }) {
  const index = new Map(); // token -> tenant
  const base = () => String(publicUrl || "").replace(/\/+$/, "");
  const prefix = () => { try { return new URL(base()).pathname.replace(/\/+$/, ""); } catch { return ""; } };
  const origin = () => { try { return new URL(base()).origin; } catch { return ""; } };
  const linkOf = (token, host) => `${base() || `http://${host}`}/drive/${token}`;

  const file = (t) => join(t.dir, "shares.json");
  function list(t) {
    if (!t.shares) {
      try { t.shares = JSON.parse(readFileSync(file(t), "utf8")); } catch { t.shares = []; }
    }
    return t.shares;
  }
  function save(t) {
    const tmp = file(t) + ".part";
    writeFileSync(tmp, JSON.stringify(t.shares, null, 1), { mode: 0o600 });
    renameSync(tmp, file(t));
  }

  /** Called once per account at start: its links start answering. */
  function load(t) {
    for (const s of list(t)) index.set(s.token, t);
  }

  const expired = (s) => s.expires_at && s.expires_at < Date.now();
  const itemOf = (t, s) => {
    const row = s.file_id ? t.store.get("files", s.file_id) : t.store.get("folders", s.folder_id);
    return row && !row.deleted ? row : null;
  };

  function view(t, s, host) {
    const item = itemOf(t, s);
    return {
      token: s.token, url: linkOf(s.token, host), access: s.access,
      file_id: s.file_id || null, folder_id: s.folder_id || null,
      name: item?.name ?? null, created_at: s.created_at, expires_at: s.expires_at || null,
      active: !!item && !expired(s),
    };
  }

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  async function readJson(req) {
    let b = "";
    for await (const c of req) { b += c; if (b.length > 8192) break; }
    try { return JSON.parse(b || "{}"); } catch { return {}; }
  }

  // --- the account's own API -----------------------------------------------------

  async function routes(t, req, res, url, path) {
    const m = req.method;
    const host = req.headers.host;
    if (path === "/api/shares" && m === "GET") {
      const fid = url.searchParams.get("file_id");
      const did = url.searchParams.get("folder_id");
      const out = list(t).filter((s) => (!fid || s.file_id === fid) && (!did || s.folder_id === did)).map((s) => view(t, s, host)).filter((s) => s.name !== null);
      return send(res, 200, out), true;
    }
    if (path === "/api/shares" && m === "POST") {
      const b = await readJson(req);
      const access = ACCESS.includes(b.access) ? b.access : "view";
      const fileId = b.file_id ? String(b.file_id) : null;
      const folderId = !fileId && b.folder_id ? String(b.folder_id) : null;
      if (!fileId && !folderId) return send(res, 400, { error: "file_id or folder_id is required" }), true;
      const row = fileId ? t.store.get("files", fileId) : t.store.get("folders", folderId);
      if (!row || row.deleted) return send(res, 404, { error: "no such file or folder" }), true;
      const days = Number(b.expires_days) || 0;
      const expires_at = EXPIRY_DAYS.includes(days) ? Date.now() + days * 86400000 : null;
      // One link per item: sharing again changes its access and keeps the link.
      let s = list(t).find((x) => (fileId ? x.file_id === fileId : x.folder_id === folderId));
      if (s) Object.assign(s, { access, expires_at });
      else {
        s = { token: randomBytes(16).toString("base64url"), file_id: fileId, folder_id: folderId, access, created_at: Date.now(), expires_at };
        list(t).push(s);
        index.set(s.token, t);
      }
      save(t);
      return send(res, 200, view(t, s, host)), true;
    }
    const d = /^\/api\/shares\/([A-Za-z0-9_-]{16,})$/.exec(path);
    if (d && m === "DELETE") {
      const all = list(t);
      const i = all.findIndex((s) => s.token === d[1]);
      if (i < 0) return send(res, 404, { error: "no such link" }), true;
      all.splice(i, 1);
      index.delete(d[1]);
      save(t);
      return send(res, 200, { ok: true }), true;
    }
    return false;
  }

  // --- the public pages ------------------------------------------------------------

  const hits = new Map(); // ip -> [ms]
  function limited(req) {
    const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((x) => now - x < 60000);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > 240;
  }

  function page(res, status, title, body, { image } = {}) {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    });
    res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Hourglass Drive</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:site_name" content="Hourglass Drive">${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
<style>
:root{--bg:#121212;--surface:#1b1b1b;--surface2:#242424;--border:#2e2e2e;--fg:#f5f5f5;--muted:#9a9a9a;--accent:#B14242;--mono:ui-monospace,"JetBrains Mono",Consolas,monospace;--sans:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme: light){:root{--bg:#f5f5f5;--surface:#ffffff;--surface2:#ececec;--border:#d9d9d9;--fg:#121212;--muted:#666}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans)}
header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);font-family:var(--mono);font-weight:700;letter-spacing:.5px}
header .dot{width:10px;height:14px;background:var(--accent)}header span{color:var(--muted);font-weight:400}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
h1{font-family:var(--mono);font-size:22px;margin:0 0 6px;word-break:break-word}.meta{color:var(--muted);font-family:var(--mono);font-size:13px;margin-bottom:18px}
.view{background:var(--surface);border:1px solid var(--border);display:flex;justify-content:center;align-items:center;min-height:120px}
.view img,.view video{max-width:100%;max-height:78vh;display:block}.view audio{width:100%;margin:24px}
.view iframe{width:100%;height:80vh;border:0;background:#fff}.view pre{margin:0;padding:16px;width:100%;overflow:auto;white-space:pre-wrap;font-family:var(--mono);font-size:13px;line-height:1.5}
.none{padding:32px 16px;color:var(--muted);font-family:var(--mono);font-size:14px;text-align:center}
.actions{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap}
a.btn{display:inline-block;padding:10px 16px;background:var(--accent);color:#fff;text-decoration:none;font-family:var(--mono);font-size:14px;font-weight:700}
a.sub{background:transparent;color:var(--fg);border:1px solid var(--border);font-weight:400}
ul.items{list-style:none;margin:0;padding:0;border:1px solid var(--border)}ul.items li+li{border-top:1px solid var(--border)}
ul.items a{display:flex;align-items:center;gap:12px;padding:10px 12px;color:var(--fg);text-decoration:none;background:var(--surface)}ul.items a:hover{background:var(--surface2)}
.thumb{width:40px;height:40px;flex:none;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;color:var(--muted);overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover}
.name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.size{color:var(--muted);font-family:var(--mono);font-size:12px}
.crumbs{font-family:var(--mono);font-size:14px;margin-bottom:14px;color:var(--muted)}.crumbs a{color:var(--accent);text-decoration:none}
footer{color:var(--muted);font-family:var(--mono);font-size:12px;text-align:center;padding:24px 16px}
</style></head><body><header><div class="dot"></div>Hourglass Drive <span>· shared link</span></header><main>${body}</main>
<footer>Shared with Hourglass · marobotic.dev</footer></body></html>`);
  }

  const gone = (res) => page(res, 404, "Link not available", `<div class="none">This link doesn't work any more. The owner may have stopped sharing it, or it expired.</div>`);

  // Bytes of one file, with Range for video seeking (Safari needs it).
  function stream(req, res, t, row, { download }) {
    const f = drivePath(t, row.id);
    if (!existsSync(f)) return gone(res);
    const total = statSync(f).size;
    const active = ACTIVE.test(row.mime || "") || /\.(html?|svg|xml|js|mjs)$/i.test(row.name);
    const type = active ? "application/octet-stream" : row.mime || "application/octet-stream";
    const headers = {
      "content-type": type,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-disposition": `${download || active ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    };
    // PDFs show in the browser's own viewer, which a sandbox would block; anything else is sandboxed.
    if (type !== "application/pdf") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && total > 0) {
      let start = range[1] === "" ? Math.max(0, total - Number(range[2])) : Number(range[1]);
      let end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start > end || start >= total) {
        res.writeHead(416, { "content-range": `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${total}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": total });
    if (req.method === "HEAD") return res.end();
    createReadStream(f).pipe(res);
  }

  async function thumb(res, t, row) {
    if (!canThumb(row) || !existsSync(drivePath(t, row.id))) return res.writeHead(404).end();
    if (/^image\//.test(row.mime) && (row.size || 0) > thumbMaxImage) return res.writeHead(404).end();
    try {
      const f = await thumbnail(t, row);
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": statSync(f).size, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" });
      createReadStream(f).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  }

  // Is this folder (or a file's folder) the shared folder or somewhere under it?
  function under(t, folderId, rootId) {
    const seen = new Set();
    for (let id = folderId; id && !seen.has(id); ) {
      if (id === rootId) return true;
      seen.add(id);
      const f = t.store.get("folders", id);
      if (!f || f.deleted) return false;
      id = f.parent_id;
    }
    return false;
  }

  function filePage(res, s, row, here, back) {
    const k = kindOf(row);
    const raw = `${here}/raw`;
    const can = s.access === "download";
    let view;
    if (k === "image") view = `<img src="${esc(raw)}" alt="${esc(row.name)}">`;
    else if (k === "video") view = `<video src="${esc(raw)}" controls playsinline preload="metadata"></video>`;
    else if (k === "audio") view = `<audio src="${esc(raw)}" controls preload="metadata"></audio>`;
    else if (k === "pdf") view = `<iframe src="${esc(raw)}" title="${esc(row.name)}"></iframe>`;
    else if (k === "text" && (row.size || 0) <= PREVIEW_TEXT) view = `<pre>${esc(readFileSync(drivePath(s.t, row.id), "utf8"))}</pre>`;
    else view = `<div class="none">This kind of file can't be shown in the browser.${can ? " Download it to open it." : " The owner shared it to view only."}</div>`;
    const actions = [
      back ? `<a class="btn sub" href="${esc(back)}">← Back to the folder</a>` : "",
      can ? `<a class="btn" href="${esc(raw)}?download=1">Download</a>` : "",
    ].join("");
    page(res, 200, row.name, `<h1>${esc(row.name)}</h1><div class="meta">${esc(size(row.size))} · ${can ? "view and download" : "view only"}</div><div class="view">${view}</div>${actions ? `<div class="actions">${actions}</div>` : ""}`,
      { image: canThumb(row) && origin() ? `${origin()}${here}/thumb` : null });
  }

  function folderPage(res, t, s, folderId, root) {
    const folders = t.store.all("folders").filter((f) => f.parent_id === folderId).sort((a, b) => a.name.localeCompare(b.name));
    const files = t.store.all("files").filter((f) => f.folder_id === folderId).sort((a, b) => a.name.localeCompare(b.name));
    const crumbs = [];
    for (let f = t.store.get("folders", folderId); f && !f.deleted; f = f.parent_id ? t.store.get("folders", f.parent_id) : null) {
      crumbs.unshift(f);
      if (f.id === s.folder_id) break;
    }
    const link = (f) => (f.id === s.folder_id ? root : `${root}/folder/${f.id}`);
    const crumbHtml = crumbs.map((f, i) => (i === crumbs.length - 1 ? `<b>${esc(f.name)}</b>` : `<a href="${esc(link(f))}">${esc(f.name)}</a>`)).join(" / ");
    const items = [
      ...folders.map((f) => `<li><a href="${esc(`${root}/folder/${f.id}`)}"><div class="thumb">DIR</div><div class="name">${esc(f.name)}</div></a></li>`),
      ...files.map((f) => `<li><a href="${esc(`${root}/file/${f.id}`)}"><div class="thumb">${canThumb(f) ? `<img src="${esc(`${root}/file/${f.id}/thumb`)}" alt="">` : esc((f.name.split(".").pop() || "").slice(0, 4).toUpperCase())}</div><div class="name">${esc(f.name)}</div><div class="size">${esc(size(f.size))}</div></a></li>`),
    ].join("");
    const top = crumbs[crumbs.length - 1];
    page(res, 200, top?.name || "Folder", `<div class="crumbs">${crumbHtml}</div><h1>${esc(top?.name || "Folder")}</h1><div class="meta">${folders.length + files.length} items · ${s.access === "download" ? "view and download" : "view only"}</div>${items ? `<ul class="items">${items}</ul>` : `<div class="none">This folder is empty.</div>`}`);
  }

  /** GET /drive/<token>[/raw|/thumb|/file/<id>[/raw|/thumb]|/folder/<id>]. True when it was one. */
  function publicRoute(req, res, path, url) {
    const m = /^\/drive\/([A-Za-z0-9_-]{16,})((?:\/(?:file|folder)\/[0-9a-f-]{36})?)(\/raw|\/thumb)?$/.exec(path);
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405, { allow: "GET, HEAD" }).end(), true;
    if (limited(req)) return res.writeHead(429, { "retry-after": "60" }).end("slow down"), true;
    const [, token, sub, tail] = m;
    const t = index.get(token);
    const s = t && list(t).find((x) => x.token === token);
    if (!s || expired(s)) return gone(res), true;
    const shared = itemOf(t, s);
    if (!shared) return gone(res), true;
    const root = `${prefix()}/drive/${token}`;
    const download = s.access === "download" && url.searchParams.get("download") === "1";
    const ctx = { ...s, t };

    if (s.file_id) {
      if (sub) return gone(res), true;
      if (tail === "/raw") return stream(req, res, t, shared, { download }), true;
      if (tail === "/thumb") return thumb(res, t, shared), true;
      return filePage(res, ctx, shared, root, null), true;
    }
    // A folder link: only things inside it.
    const [, what, id] = /^(?:\/(file|folder)\/([0-9a-f-]{36}))?$/.exec(sub) || [];
    if (what === "file") {
      const row = t.store.get("files", id);
      if (!row || row.deleted || !under(t, row.folder_id, s.folder_id)) return gone(res), true;
      if (tail === "/raw") return stream(req, res, t, row, { download }), true;
      if (tail === "/thumb") return thumb(res, t, row), true;
      const back = row.folder_id === s.folder_id ? root : `${root}/folder/${row.folder_id}`;
      return filePage(res, ctx, row, `${root}/file/${row.id}`, back), true;
    }
    if (tail) return gone(res), true;
    const folderId = what === "folder" ? id : s.folder_id;
    if (!under(t, folderId, s.folder_id)) return gone(res), true;
    return folderPage(res, t, s, folderId, root), true;
  }

  return { load, routes, publicRoute };
}
