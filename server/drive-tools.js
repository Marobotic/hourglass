// Assistant operations on this account's server-side Drive files.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isText, lineDiff } from "./versions.js";

const MAX = 200 * 1024;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mime = (name) => ({ txt:"text/plain", md:"text/markdown", csv:"text/csv", json:"application/json", html:"text/html", js:"text/javascript" }[name.split(".").pop().toLowerCase()] || "application/octet-stream");

export function createDriveTools(t, { drivePath, versions }) {
  const rowOf = (id) => { const f = t.store.get("files", String(id)); if (!f || f.deleted) throw new Error("Drive file not found"); return f; };
  const pathOf = (target) => {
    const parts = String(target || "").replaceAll("\\", "/").split("/").filter(Boolean);
    if (!parts.length) throw new Error("path is required");
    const leaf = parts.pop();
    let parent = null;
    for (const part of parts) {
      const found = t.store.all("folders").filter((f) => f.name === part && (f.parent_id || null) === parent);
      if (found.length !== 1) throw new Error(found.length ? `Ambiguous folder: ${part}` : `Folder not found: ${part}`);
      parent = found[0].id;
    }
    const hits = t.store.all("files").filter((f) => !f.course_id && (f.folder_id || null) === parent && f.name === leaf);
    if (hits.length > 1) throw new Error(`Ambiguous Drive path: ${target}`);
    return { row: hits[0] || null, name: leaf, folder_id: parent };
  };
  const resolve = ({ file_id, path }) => file_id ? { row: rowOf(file_id) } : pathOf(path);
  const permissionFor = (name, args = {}) => name === "write_file" && resolve(args).row ? "risky" : undefined;
  const hashFor = (name, args = {}) => {
    if (name !== "write_file" && name !== "edit_file") return null;
    const hit = resolve(args);
    return hit.row ? sha(readFileSync(drivePath(t, hit.row.id))) : null;
  };
  const assertUnchanged = (name, args, expected) => {
    let current;
    try { current = hashFor(name, args); } catch { current = Symbol("missing"); }
    if (current !== expected) throw new Error("This Drive file changed after the proposal. Ask the assistant to review the latest version before applying.");
  };
  const persist = (row, bytes, who = { by: t.email || null, device: null }) => {
    if (bytes.length > 1024 * 1024 * 1024) throw new Error("file content exceeds the 1 GB limit");
    if (row) {
      const before = isText(row) ? readFileSync(drivePath(t, row.id)).toString("utf8") : "";
      const tmp = drivePath(t, row.id) + ".assistant";
      writeFileSync(tmp, bytes);
      versions.replace(t, row, tmp, who, { size: bytes.length });
      const updated = t.store.upsert("files", { id: row.id, size: bytes.length, sha256: sha(bytes) });
      const diff = isText(row) ? lineDiff(before, bytes.toString("utf8")) : { added: 0, removed: 0 };
      return { ...updated, changes: { added: diff.added, removed: diff.removed } };
    }
  };
  const writeBytes = ({ file_id, path, bytes }) => {
    const hit = resolve({ file_id, path });
    if (hit.row) return persist(hit.row, Buffer.from(bytes));
    const name = hit.name || basename(path || "file");
    if (!name) throw new Error("path is required to create a file");
    const id = randomUUID(), dst = drivePath(t, id); mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, bytes);
    const saved = t.store.upsert("files", { id, name, folder_id: hit.folder_id || null, size: bytes.length, sha256: sha(bytes), mime: mime(name) });
    versions.started(t, id, { by: t.email || null, device: null }, bytes.length);
    return { ...saved, created: true, changes: { added: bytes.toString("utf8").split(/\r?\n/).length, removed: 0 } };
  };
  return {
    permissionFor,
    hashFor,
    assertUnchanged,
    read(args) {
      const { row } = resolve(args); if (!row) throw new Error("Drive file not found");
      if (!isText(row)) throw new Error(/^image\//.test(row.mime || "") ? "Images are unsupported by text engines." : "This format cannot be read as text yet.");
      const bytes = readFileSync(drivePath(t, row.id));
      if (bytes.length > 20 * 1024 * 1024) throw new Error("File is too large to read as text (20 MB maximum).");
      t.service.driveFiles.onRead?.(row);
      const offset = args.offset || 0, limit = Math.min(args.limit || MAX, MAX);
      return { file_id: row.id, name: row.name, size: bytes.length, offset, content: bytes.subarray(offset, offset + limit).toString("utf8"), next_offset: offset + limit < bytes.length ? offset + limit : null };
    },
    write(args) {
      return writeBytes({ ...args, bytes: Buffer.from(args.content, "utf8") });
    },
    writeBytes,
    edit({ file_id, old_text, new_text }) {
      const row = rowOf(file_id); if (!isText(row)) throw new Error("This format cannot be edited as text yet.");
      const content = readFileSync(drivePath(t, row.id)).toString("utf8");
      const first = content.indexOf(old_text); if (first < 0) throw new Error("old_text was not found");
      if (content.indexOf(old_text, first + Math.max(1, old_text.length)) >= 0) throw new Error("old_text must occur exactly once");
      return persist(row, Buffer.from(content.slice(0, first) + new_text + content.slice(first + old_text.length)));
    },
    delete({ file_id }) {
      const row = rowOf(file_id); versions.archive(t, row); rmSync(drivePath(t, row.id), { force: true });
      return t.store.remove("files", row.id);
    },
    rename({ file_id, name }) { const row = rowOf(file_id); const clean = String(name).replace(/[\\/]/g, "_").trim().slice(0, 200); if (!clean) throw new Error("name is required"); return t.store.upsert("files", { id: row.id, name: clean }); },
    listVersions({ file_id }) { const row = t.store.get("files", String(file_id)); if (!row) throw new Error("Drive file not found"); return versions.list(t, row); },
    restore({ file_id, version_id }) {
      const row = t.store.get("files", String(file_id)), v = row && versions.get(t, row.id, version_id);
      if (!row || !v || !existsSync(versions.path(t, row.id, version_id))) throw new Error("That version is no longer kept.");
      const bytes = readFileSync(versions.path(t, row.id, version_id));
      if (row.deleted) { const tmp = drivePath(t, row.id) + ".assistant-restore"; writeFileSync(tmp, bytes); renameSync(tmp, drivePath(t, row.id)); }
      else { const tmp = drivePath(t, row.id) + ".assistant-restore"; writeFileSync(tmp, bytes); versions.replace(t, row, tmp, { by: t.email || null, device: null }, { size: bytes.length, restored_from: version_id }); }
      versions.restored(t, row.id);
      return t.store.upsert("files", { id: row.id, deleted: 0, size: bytes.length, sha256: sha(bytes) });
    },
  };
}
