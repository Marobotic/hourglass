// Drive file versions. When a file's contents are replaced (an edit saved on
// a device, or a restore), the old bytes are kept as a version beside it, with
// who replaced them, from which device and when. Each file keeps its last 20;
// they count toward the account's storage. A version can be downloaded,
// compared with the current file (a line diff for text) and restored, which
// keeps the current contents as a version too, so nothing is ever lost by it.
//
// The log is a small JSON file per Drive file in the account's data folder
// (local disk); the bytes sit next to the file's own (the Drive storage).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { copyFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const KEEP = 20;

// Text a person edits: compared line by line. Anything else: by size and date.
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|ps1|bat|ini|toml|ya?ml|sql|log|tex|srt|vtt|qml|svg)$/i;
export const isText = (row) => /^text\//.test(row.mime || "") || /json|xml|javascript/.test(row.mime || "") || TEXT_EXT.test(row.name || "");
export const isPicture = (row) => /^image\//.test(row.mime || "") && !/svg/.test(row.mime || "");

// Who made a change: the account and, when the app says, the device.
export function whoOf(t, req) {
  let device = null;
  try { device = decodeURIComponent(String(req.headers["x-hourglass-device"] || "")).trim().slice(0, 80) || null; } catch {}
  return { by: t.email || null, device };
}

export function createVersions({ drivePath }) {
  const dir = (t, id) => join(dirname(drivePath(t, id)), "versions", id);
  const logFile = (t, id) => join(t.dir, "versions", `${id}.json`);
  const read = (t, id) => {
    try { return JSON.parse(readFileSync(logFile(t, id), "utf8")); } catch { return { current: null, versions: [] }; }
  };
  const write = (t, id, log) => {
    mkdirSync(join(t.dir, "versions"), { recursive: true });
    writeFileSync(logFile(t, id), JSON.stringify(log));
  };
  const path = (t, id, vid) => join(dir(t, id), vid);
  // Past the last KEEP, the oldest go (their bytes too).
  const prune = (log, t, id) => {
    for (const v of log.versions.splice(KEEP)) rmSync(path(t, id, v.id), { force: true });
  };

  return {
    path,
    // A new file: who put it there.
    started(t, id, who, size) {
      write(t, id, { current: { ...who, at: Date.now(), size }, versions: [] });
    },
    // The current bytes are about to be replaced by the file at `incoming`:
    // keep them as a version, put the new ones in place, log who did it.
    replace(t, row, incoming, who, extra = {}) {
      const log = read(t, row.id);
      const now = drivePath(t, row.id);
      if (existsSync(now)) {
        const vid = randomUUID();
        mkdirSync(dir(t, row.id), { recursive: true });
        renameSync(now, path(t, row.id, vid));
        const was = log.current || {};
        log.versions.unshift({ id: vid, at: was.at || row.updated_at || Date.now(), size: was.size ?? row.size ?? 0, by: was.by ?? null, device: was.device ?? null, name: row.name, ...(was.restored_from ? { restored_from: was.restored_from } : {}) });
      }
      renameSync(incoming, now);
      log.current = { ...who, at: Date.now(), size: extra.size ?? row.size ?? 0, ...(extra.restored_from ? { restored_from: extra.restored_from } : {}) };
      prune(log, t, row.id);
      write(t, row.id, log);
      return log;
    },
    list(t, row) {
      const log = read(t, row.id);
      return {
        current: { at: log.current?.at || row.updated_at, size: row.size, by: log.current?.by ?? null, device: log.current?.device ?? null, restored_from: log.current?.restored_from ?? null },
        versions: log.versions.filter((v) => existsSync(path(t, row.id, v.id))),
        text: isText(row),
        picture: isPicture(row),
      };
    },
    get(t, id, vid) {
      return read(t, id).versions.find((v) => v.id === vid) || null;
    },
    // A copy of the version's bytes next to the current file, to restore from.
    async copyOut(t, id, vid) {
      const tmp = drivePath(t, id) + ".restore";
      await copyFile(path(t, id, vid), tmp);
      return tmp;
    },
    // Bytes kept in versions, for the storage line.
    bytes(t, ids) {
      let n = 0;
      for (const id of ids) for (const v of read(t, id).versions) n += v.size || 0;
      return n;
    },
    async remove(t, id) {
      await rm(dir(t, id), { recursive: true, force: true });
      await rm(logFile(t, id), { force: true });
    },
    readText: (file) => readFile(file, "utf8"),
  };
}

/**
 * What changed between two texts, line by line: [{ op: "same" | "add" | "del",
 * text, a, b }] (a and b are 1-based line numbers in the old and new text), with
 * long unchanged stretches folded into { op: "skip", count }. Over `limit`
 * changed lines on either side it gives up with { tooBig: true } and the counts.
 */
export function lineDiff(oldText, newText, { context = 3, limit = 3000 } = {}) {
  const a = oldText.split(/\r?\n/), b = newText.split(/\r?\n/);
  // Same start and end are taken off first: most edits touch a few lines.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf), bm = b.slice(pre, b.length - suf);
  if (am.length > limit || bm.length > limit) return { tooBig: true, added: bm.length, removed: am.length, lines: [] };
  // Longest common subsequence of the middles, then walked from the start.
  const n = am.length, m = bm.length;
  const L = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i * (m + 1) + j] = am[i] === bm[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  }
  const ops = [];
  for (let k = 0; k < pre; k++) ops.push({ op: "same", text: a[k], a: k + 1, b: k + 1 });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) { ops.push({ op: "same", text: am[i], a: pre + i + 1, b: pre + j + 1 }); i++; j++; }
    // A changed line reads as the old one taken out, then the new one put in.
    else if (i < n && (j === m || L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1])) { ops.push({ op: "del", text: am[i], a: pre + i + 1 }); i++; }
    else { ops.push({ op: "add", text: bm[j], b: pre + j + 1 }); j++; }
  }
  for (let k = 0; k < suf; k++) ops.push({ op: "same", text: a[a.length - suf + k], a: a.length - suf + k + 1, b: b.length - suf + k + 1 });
  // Fold what didn't change, keeping a few lines around each change.
  const near = new Uint8Array(ops.length);
  ops.forEach((o, k) => { if (o.op !== "same") for (let d = -context; d <= context; d++) if (k + d >= 0 && k + d < ops.length) near[k + d] = 1; });
  const lines = [];
  for (let k = 0; k < ops.length; k++) {
    if (near[k]) { lines.push(ops[k]); continue; }
    let s = k;
    while (k + 1 < ops.length && !near[k + 1]) k++;
    lines.push({ op: "skip", count: k - s + 1 });
  }
  return { tooBig: false, added: ops.filter((o) => o.op === "add").length, removed: ops.filter((o) => o.op === "del").length, lines };
}
