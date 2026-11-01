import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const FILE_SCAN_CONCURRENCY = 16;
const UNIT_BYTES = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

export function parseRcloneAbout(output) {
  const fields = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(Total|Used|Free|Trashed|Other):\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]+)?\s*$/i.exec(line);
    if (!match) continue;
    const unit = (match[3] || "B").toUpperCase();
    const multiplier = UNIT_BYTES[unit];
    if (!multiplier) continue;
    fields.set(match[1].toLowerCase(), Math.round(Number(match[2].replaceAll(",", "")) * multiplier));
  }
  if (!fields.has("total") || !fields.has("used") || !fields.has("free")) return null;
  const trashed = fields.get("trashed") || 0;
  return {
    total: fields.get("total"),
    used: fields.get("used") + trashed,
    free: fields.get("free"),
    trashed,
    other: fields.get("other") || 0,
  };
}

async function eachLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index]);
    }
  }));
}

// Scan asynchronously with bounded concurrent file stats. The mount contains
// actual Drive bytes; statfs on rclone can report quota capacity as free space.
export async function measureDriveTree(root) {
  const queue = [{ path: root, userSubdir: null, isRoot: true, depth: 0, inDriveTree: false }];
  const driveDirs = new Set();
  const driveBytes = new Map();
  let used = 0;

  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir.path, { withFileTypes: true });
    } catch (error) {
      // A child can disappear while a live Drive mount is being synchronized.
      if (error.code === "ENOENT" && dir.isRoot) return { used: 0, driveDirs, driveBytes };
      if (error.code === "ENOENT") continue;
      throw error;
    }

    let dirBytes = 0;
    const childDirs = [];
    await eachLimit(entries, FILE_SCAN_CONCURRENCY, async (entry) => {
      const path = join(dir.path, entry.name);
      // rclone's FUSE mount hands back entries with an unknown type, so the
      // directory entry cannot be trusted: ask the file itself.
      const info = await stat(path).catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)));
      if (!info) return;
      if (info.isDirectory()) {
        const userSubdir = dir.isRoot ? entry.name : dir.userSubdir;
        const inDriveTree = dir.inDriveTree || (dir.depth === 1 && entry.name === "drive");
        if (inDriveTree && userSubdir !== null && dir.depth === 1) driveDirs.add(userSubdir);
        childDirs.push({ path, userSubdir, isRoot: false, depth: dir.depth + 1, inDriveTree });
      } else if (info.isFile()) {
        dirBytes += info.size;
      }
    });

    used += dirBytes;
    if (dir.inDriveTree && dir.userSubdir !== null) {
      driveBytes.set(dir.userSubdir, (driveBytes.get(dir.userSubdir) || 0) + dirBytes);
    }
    queue.push(...childDirs);
  }

  return { used, driveDirs, driveBytes };
}

export function sumFileSizes(files) {
  return files.reduce((sum, file) => {
    const size = Number(file.size);
    return sum + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
}
