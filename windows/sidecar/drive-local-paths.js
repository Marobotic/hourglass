import { createHash } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const within = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

function pairRelativePath(pair, paths, base, id, field) {
  for (const [path, value] of paths || []) if (value === id) return path;
  for (const [path, value] of Object.entries(base || {})) {
    if (value === id || value?.[field] === id) return path;
  }
  if (field === "folder_id" && pair.folder_id === id) return "";
  return null;
}

function localPath(pair, rel, io) {
  if (rel === null || rel === undefined || typeof rel !== "string") return null;
  const parts = rel.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..") || isAbsolute(rel)) return null;
  try {
    const root = io.realpath(pair.local);
    const candidate = io.realpath(resolve(root, ...parts));
    return within(root, candidate) ? candidate : null;
  } catch { return null; }
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function pairCoversFile(pair, id) {
  return !!pair && !!id && (
    (pair.syncedFilePaths && [...pair.syncedFilePaths.values()].includes(id))
    || Object.values(pair.base?.files || {}).some((entry) => entry?.file_id === id)
  );
}

export function fileBelongsToPair(pair, row, folders = []) {
  if (!pair || !row || row.deleted) return false;
  if (pair.mode === "pull" && pair.course_id && row.course_id === pair.course_id) return true;
  let parent = row.folder_id || null;
  const seen = new Set();
  while (parent && !seen.has(parent)) {
    if (parent === pair.folder_id) return true;
    seen.add(parent);
    parent = folders.find((folder) => folder.id === parent)?.parent_id || null;
  }
  return false;
}

export async function mapPairFile(pair, id, row, io = { realpath: realpathSync, stat: statSync, hash: hashFile }) {
  if (!pair || !id) return null;
  const rel = pairRelativePath(pair, pair.syncedFilePaths, pair.base?.files, id, "file_id");
  if (rel === null) return null;
  const path = localPath(pair, rel, io);
  if (!path) return null;
  try {
    const stat = io.stat(path);
    if (!stat.isFile()) return null;
    const base = pair.base?.files?.[rel];
    const expectedHash = row?.sha256 || base?.sha256;
    const expectedSize = row?.size ?? base?.size;
    if (!expectedHash || Number(stat.size) !== Number(expectedSize)) return null;
    if (await io.hash(path) !== expectedHash) return null;
    return { path, matched: true, relative: rel };
  } catch { return null; }
}

export function mapPairFilePath(pair, id, io = { realpath: realpathSync, stat: statSync }) {
  if (!pair || !id) return null;
  const rel = pairRelativePath(pair, pair.syncedFilePaths, pair.base?.files, id, "file_id");
  const path = localPath(pair, rel, io);
  if (!path) return null;
  try { return io.stat(path).isFile() ? { path, relative: rel } : null; }
  catch { return null; }
}

export function mapPairFolder(pair, id, io = { realpath: realpathSync, stat: statSync }) {
  if (!pair || !id) return null;
  const rel = pairRelativePath(pair, pair.syncedFolderPaths, pair.base?.folders, id, "folder_id");
  const path = localPath(pair, rel, io);
  if (!path) return null;
  try { return io.stat(path).isDirectory() ? { path, relative: rel } : null; }
  catch { return null; }
}

export function validatePairFolder(pair, candidate, io = { realpath: realpathSync, stat: statSync }) {
  if (!pair?.local || !candidate) return null;
  try {
    const root = io.realpath(pair.local);
    const target = io.realpath(candidate);
    if (!within(root, target) || !io.stat(target).isDirectory()) return null;
    return target;
  } catch { return null; }
}
