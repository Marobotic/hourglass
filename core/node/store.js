// SQLite store shared by the server (source of truth) and the Linux sidecar
// (local replica). Node-only: uses the built-in node:sqlite.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TABLES, TABLE_NAMES, normalize } from "../model.js";

const sqlType = { text: "TEXT", int: "INTEGER", bool: "INTEGER", json: "TEXT" };
const VERSION_GAP = 10 * 60000;
const VERSION_CAP = 40;

export class Store {
  // replica: a client copy. Local changes keep the server rev and are marked
  // dirty until pushed, instead of taking a new rev.
  // clock: what time it is (the Windows sidecar passes one corrected by the server's clock).
  constructor(path, { replica = false, clock = () => Date.now() } = {}) {
    this.replica = replica;
    this.clock = clock;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    for (const t of TABLE_NAMES) {
      const cols = TABLES[t].map(([n, type]) => `${n} ${sqlType[type]}`).join(", ");
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, ${cols}, updated_at INTEGER NOT NULL,
         deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0)`,
      );
      this.db.exec(`CREATE INDEX IF NOT EXISTS ${t}_rev ON ${t}(rev)`);
      // Columns added after a table was created.
      const have = new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      for (const [n, type] of TABLES[t]) if (!have.has(n)) this.db.exec(`ALTER TABLE ${t} ADD COLUMN ${n} ${sqlType[type]}`);
    }
    this.listeners = new Set();
  }

  meta(key, fallback = null) {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return r ? JSON.parse(r.value) : fallback;
  }

  setMeta(key, value) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  nextRev() {
    const rev = this.meta("rev", 0) + 1;
    this.setMeta("rev", rev);
    return rev;
  }

  decode(table, r) {
    if (!r) return null;
    const out = { ...r };
    for (const [n, type] of TABLES[table]) if (type === "json" && out[n] != null) out[n] = JSON.parse(out[n]);
    return out;
  }

  get(table, id) {
    return this.decode(table, this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  }

  all(table, { withDeleted = false } = {}) {
    const sql = `SELECT * FROM ${table}${withDeleted ? "" : " WHERE deleted = 0"}`;
    return this.db.prepare(sql).all().map((r) => this.decode(table, r));
  }

  snapshot() {
    return Object.fromEntries(TABLE_NAMES.map((t) => [t, this.all(t)]));
  }

  // Write a full, normalized row. Last write wins on updated_at.
  // mode "local": a change made here (marks dirty on replicas).
  // mode "remote": a row pulled from the server (keeps its rev, never dirty).
  write(table, row, { mode = "local", assignRev = !this.replica } = {}) {
    const existing = this.get(table, row.id);
    if (existing && existing.updated_at > row.updated_at) return { row: existing, applied: false };
    // The source of truth keeps the text a note had before it changed.
    if (table === "notes" && !this.replica && existing && !existing.deleted && (existing.body !== row.body || existing.title !== row.title)) {
      this.keepVersion(existing);
    }
    const cols = [...TABLES[table].map(([n]) => n), "updated_at", "deleted"];
    const vals = cols.map((c) => {
      const type = TABLES[table].find(([n]) => n === c)?.[1];
      const v = row[c];
      return type === "json" && v != null ? JSON.stringify(v) : v ?? null;
    });
    const rev = mode === "remote" ? row.rev ?? 0 : assignRev ? this.nextRev() : existing?.rev ?? 0;
    const dirty = mode === "local" && !assignRev ? 1 : 0;
    const all = ["id", ...cols, "rev", "dirty"];
    this.db
      .prepare(`INSERT INTO ${table} (${all.join(", ")}) VALUES (${all.map(() => "?").join(", ")})
        ON CONFLICT(id) DO UPDATE SET ${all.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`)
      .run(row.id, ...vals, rev, dirty);
    const saved = this.get(table, row.id);
    for (const fn of this.listeners) fn(table, saved);
    return { row: saved, applied: true };
  }

  // Create or patch through normalize (validates the merged result).
  upsert(table, patch, opts) {
    const existing = patch.id ? this.get(table, patch.id) : null;
    // Writing to a deleted row brings it back (marks reuse one id per day:
    // clear a day, mark it again, and it must not stay deleted).
    const merged = normalize(table, { ...(existing ?? {}), ...patch, deleted: patch.deleted ? 1 : 0, updated_at: Math.max(this.clock(), (existing?.updated_at ?? 0) + 1) });
    return this.write(table, merged, opts).row;
  }

  remove(table, id, opts) {
    const existing = this.get(table, id);
    if (!existing) return null;
    return this.write(table, { ...existing, deleted: 1, updated_at: Math.max(this.clock(), existing.updated_at + 1) }, opts).row;
  }

  // Save a note's current text as a version. An edit keeps at most one per
  // VERSION_GAP (the text before that stretch of typing); a conflict or a
  // restore always keeps one. Never two identical in a row.
  keepVersion(note, { reason = "edit", force = false } = {}) {
    if (!note.body && !note.title) return null;
    const mine = this.db
      .prepare("SELECT * FROM note_versions WHERE note_id = ? AND deleted = 0 ORDER BY saved_at DESC")
      .all(note.id)
      .map((r) => this.decode("note_versions", r));
    const last = mine[0];
    if (last && last.body === note.body && last.title === note.title) return null;
    if (!force && reason === "edit" && last && this.clock() - last.updated_at < VERSION_GAP) return null;
    const v = this.write("note_versions", normalize("note_versions", { note_id: note.id, title: note.title, body: note.body, saved_at: note.updated_at, reason }));
    for (const old of mine.slice(VERSION_CAP - 1)) this.remove("note_versions", old.id);
    return v.row;
  }

  changesSince(rev) {
    const out = {};
    for (const t of TABLE_NAMES) out[t] = this.db.prepare(`SELECT * FROM ${t} WHERE rev > ? ORDER BY rev`).all(rev).map((r) => this.decode(t, r));
    return { rev: this.meta("rev", 0), changes: out };
  }

  dirtyRows() {
    const out = {};
    for (const t of TABLE_NAMES) out[t] = this.db.prepare(`SELECT * FROM ${t} WHERE dirty = 1`).all().map((r) => this.decode(t, r));
    return out;
  }

  clearDirty(table, id, updatedAt) {
    this.db.prepare(`UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at = ?`).run(id, updatedAt);
  }

  // Record the server rev a pushed row got (the base for the next edit).
  setRev(table, id, rev) {
    this.db.prepare(`UPDATE ${table} SET rev = ? WHERE id = ?`).run(rev, id);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// Next free numbered title: "Untitled" -> "Untitled 01", "Hello" -> "Hello 02".
export function numberedTitle(store, base, { startAt = 1 } = {}) {
  const stem = String(base || "Untitled").replace(/\s+\d{2,}$/, "").trim() || "Untitled";
  const taken = new Set(store.all("notes").map((n) => n.title));
  for (let i = startAt; ; i++) {
    const t = `${stem} ${String(i).padStart(2, "0")}`;
    if (!taken.has(t)) return t;
  }
}

// Server side of sync: apply rows pushed by a client, and report the rev each
// accepted row got so the client can base its next edit on it. A note edited
// on two devices at once is never copied: the newer edit wins and the other
// text is kept as a version of the same note.
export function applyPush(store, changes) {
  const result = { applied: 0, conflicts: 0, revs: {} };
  const note = (t, row) => ((result.revs[t] ??= {})[row.id] = row.rev);
  for (const t of TABLE_NAMES) {
    if (t === "note_versions") continue; // written by the server only
    for (const incoming of changes?.[t] ?? []) {
      const row = normalize(t, incoming);
      const existing = store.get(t, row.id);
      const baseRev = Number(incoming.base_rev ?? incoming.rev ?? 0);
      if (t === "notes" && existing && !existing.deleted && !row.deleted && existing.rev > baseRev && existing.body !== row.body && existing.body && row.body) {
        if (existing.updated_at > row.updated_at) {
          // This device's text lost: keep it where the versions menu shows it.
          store.keepVersion({ ...row, id: existing.id }, { reason: "conflict", force: true });
          note(t, existing);
          result.conflicts++;
          continue;
        }
        store.keepVersion(existing, { reason: "conflict", force: true });
        result.conflicts++;
      }
      const w = store.write(t, row);
      if (w.applied) result.applied++;
      note(t, w.row);
    }
  }
  return result;
}
