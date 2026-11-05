import { createHash, randomUUID } from "node:crypto";
import { watch, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileBelongsToPair, mapPairFile, mapPairFilePath, mapPairFolder } from "./drive-local-paths.js";

const ignored = (name) => name === "desktop.ini"
  || name === "Thumbs.db"
  || name === ".DS_Store"
  || name.startsWith("~$")
  || /\.(tmp|part|crdownload)$/i.test(name);

const within = (parent, path) => {
  const rel = relative(resolve(parent), resolve(path));
  return !rel.startsWith("..")
    && !resolve(parent).startsWith(resolve(path) + sep)
    && (rel === "" || !rel.startsWith(".." + sep));
};

const same = (a, b) => !!a && !!b && a.sha256 === b.sha256;

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function conflictName(path, device, date = new Date()) {
  const ext = extname(path);
  const stem = basename(path, ext);
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`;
  return `${stem} (conflict, ${device} ${stamp})${ext}`;
}

// Compare the file and folder trees without touching disk or the store.
export function compareTrees(local, remote, base, {
  device = "PC",
  now = new Date(),
  stable = new Set(),
  pending = new Set(),
  pendingRemote = new Set(),
  maxDeletes = 20,
  mode = "two-way",
} = {}) {
  const localFiles = local.files || local;
  const remoteFiles = remote.files || remote;
  const baseFiles = base.files || base;
  const localFolders = local.folders || {};
  const remoteFolders = remote.folders || {};
  const baseFolders = base.folders || {};
  const actions = [];
  const consumed = new Set();

  // File ids identify remote moves. Hashes identify local moves.
  for (const [oldPath, entry] of Object.entries(baseFiles)) {
    if (mode === "pull") {
      // A pull pair follows remote moves, but local moves are user edits and
      // must never be reflected back to Drive.
      if (!localFiles[oldPath] && remoteFiles[oldPath]) {
        const movedRemote = Object.entries(remoteFiles).find(([path, file]) => path !== oldPath && file.file_id === entry.file_id);
        if (movedRemote) {
          actions.push({ type: "remote_move", from: oldPath, path: movedRemote[0], remote: movedRemote[1] });
          consumed.add(oldPath);
          consumed.add(movedRemote[0]);
        }
      }
      continue;
    }
    if (!localFiles[oldPath]) {
      const movedLocal = Object.entries(localFiles).find(([path, file]) =>
        path !== oldPath && !baseFiles[path] && file.sha256 === entry.sha256 && stable.has(path));
      if (movedLocal) {
        actions.push({ type: "local_move", from: oldPath, path: movedLocal[0], file_id: entry.file_id, local: movedLocal[1] });
        consumed.add(oldPath);
        consumed.add(movedLocal[0]);
        continue;
      }
    }

    if (remoteFiles[oldPath] || !localFiles[oldPath]) continue;
    const movedRemote = Object.entries(remoteFiles).find(([path, file]) =>
      path !== oldPath && file.file_id === entry.file_id);
    if (movedRemote) {
      actions.push({ type: "remote_move", from: oldPath, path: movedRemote[0], remote: movedRemote[1] });
      consumed.add(oldPath);
      consumed.add(movedRemote[0]);
    }
  }

  let deleteLocal = 0;
  let deleteRemote = 0;
  const filePaths = new Set([
    ...Object.keys(localFiles),
    ...Object.keys(remoteFiles),
    ...Object.keys(baseFiles),
  ]);

  // A remote file the server has not hashed yet is only "pending" for a
  // two-way pair, which must wait for the hash to compare. A pull copy has
  // nothing to compare against, so it downloads it now.
  for (const path of filePaths) {
    if (consumed.has(path) || pending.has(path) || (mode !== "pull" && pendingRemote.has(path))) continue;

    const localFile = localFiles[path];
    const remoteFile = remoteFiles[path];
    const baseFile = baseFiles[path];

    if (!baseFile) {
      if (mode === "pull") {
        if (!remoteFile) continue; // local-only: never uploaded, never deleted
        if (!localFile) {
          actions.push({ type: "download", path, remote: remoteFile });
          continue;
        }
        // Both sides have it and nothing was recorded yet: hashes say whether
        // they match, sizes are all there is until the server hashes its copy.
        const known = !!remoteFile.sha256 && !!localFile.sha256;
        const matching = known
          ? localFile.sha256 === remoteFile.sha256
          : Number(localFile.size) === Number(remoteFile.size);
        if (matching) actions.push({ type: "record", path, local: localFile, remote: remoteFile });
        else actions.push({ type: "pull_conflict", path, conflict: conflictName(path, device, now), local: localFile, remote: remoteFile, local_only: true });
        continue;
      }
      if (localFile && remoteFile) {
        if (same(localFile, remoteFile)) {
          actions.push({ type: "record", path, local: localFile, remote: remoteFile });
        } else {
          actions.push({ type: "conflict", path, conflict: conflictName(path, device, now), local: localFile, remote: remoteFile });
        }
      } else if (localFile && stable.has(path)) {
        actions.push({ type: "upload", path, local: localFile });
      } else if (remoteFile) {
        actions.push({ type: "download", path, remote: remoteFile });
      }
      continue;
    }

    const localChanged = localFile && localFile.sha256 !== baseFile.sha256 && stable.has(path);
    const remoteChanged = remoteFile && (remoteFile.sha256 !== baseFile.sha256 || remoteFile.file_id !== baseFile.file_id);

    if (localFile && remoteFile) {
      if (mode === "pull") {
        // Until the server has hashed its copy, size is the only signal: a file
        // whose size still matches is unchanged, and one that changed is
        // downloaded again.
        const remoteChangedNow = remoteFile.file_id !== baseFile.file_id
          || (remoteFile.sha256 && baseFile.sha256
            ? remoteFile.sha256 !== baseFile.sha256
            : Number(remoteFile.size) !== Number(baseFile.size));
        const localChangedNow = baseFile.sha256 && localFile.sha256
          ? localFile.sha256 !== baseFile.sha256 && stable.has(path)
          : Number(localFile.size) !== Number(baseFile.size) && stable.has(path);
        if (!localChangedNow && !remoteChangedNow) actions.push({ type: "record", path, local: localFile, remote: remoteFile });
        else if (!localChangedNow && remoteChangedNow) actions.push({ type: "download", path, remote: remoteFile });
        else if (localChangedNow && remoteChangedNow) {
          actions.push({ type: "pull_conflict", path, conflict: conflictName(path, device, now), local: localFile, remote: remoteFile });
        } else actions.push({ type: "record", path, local: localFile, remote: remoteFile });
        continue;
      }
      if (!localChanged && !remoteChanged) {
        actions.push({ type: "record", path, local: localFile, remote: remoteFile });
      } else if (localChanged && !remoteChanged) {
        actions.push({ type: "upload", path, local: localFile, remote: remoteFile });
      } else if (!localChanged && remoteChanged) {
        actions.push({ type: "download", path, remote: remoteFile });
      } else if (localFile.sha256 === remoteFile.sha256) {
        actions.push({ type: "record", path, local: localFile, remote: remoteFile });
      } else {
        actions.push({ type: "conflict", path, conflict: conflictName(path, device, now), local: localFile, remote: remoteFile });
      }
    } else if (localFile && !remoteFile) {
      if (mode === "pull") {
        // A base entry means this was downloaded by the pair. Remote deletion
        // removes that copy even if it was edited locally; local-only files
        // have no base entry and were handled above.
        if (baseFile.local_only) actions.push({ type: "forget", path });
        else {
          actions.push({ type: "delete_local", path, file_id: baseFile.file_id, local: localFile });
          deleteLocal++;
        }
        continue;
      }
      if (localChanged) {
        actions.push({ type: "upload", path, local: localFile });
      } else {
        actions.push({ type: "delete_local", path, file_id: baseFile.file_id, local: localFile });
        deleteLocal++;
      }
    } else if (!localFile && remoteFile) {
      if (remoteChanged) {
        actions.push({ type: "download", path, remote: remoteFile });
      } else {
        actions.push({ type: "delete_remote", path, remote: remoteFile, file_id: remoteFile.file_id });
        deleteRemote++;
      }
    } else {
      actions.push({ type: "forget", path });
    }
  }

  // A folder delete is eligible only when the other side has no new or changed files under it.
  const folderPaths = new Set([
    ...Object.keys(localFolders),
    ...Object.keys(remoteFolders),
    ...Object.keys(baseFolders),
  ]);
  for (const path of folderPaths) {
    if (!path || !baseFolders[path]) continue;
    const localHas = Object.hasOwn(localFolders, path);
    const remoteHas = Object.hasOwn(remoteFolders, path);
    if (localHas === remoteHas) continue;

    const otherFiles = localHas ? localFiles : remoteFiles;
    const otherPending = localHas ? pending : pendingRemote;
    const hasNewOrChanged = Object.entries(otherFiles).some(([filePath, file]) => {
      if (!filePath.startsWith(`${path}/`)) return false;
      const prior = baseFiles[filePath];
      return otherPending.has(filePath) || !prior || file.sha256 !== prior.sha256;
    });
    if (hasNewOrChanged) continue;

    if (!localHas) {
      if (mode !== "pull") {
        actions.push({ type: "delete_remote_folder", path, folder_id: remoteFolders[path] });
        deleteRemote++;
      }
    } else {
      actions.push({ type: "delete_local_folder", path, folder_id: baseFolders[path] });
      deleteLocal++;
    }
  }

  const baseCount = Math.max(Object.keys(baseFiles).length, 1);
  const massDelete = mode !== "pull" && (deleteLocal > maxDeletes
    || deleteRemote > maxDeletes
    || (deleteLocal >= 5 && deleteLocal / baseCount > 0.25)
    || (deleteRemote >= 5 && deleteRemote / baseCount > 0.25));

  return {
    actions: massDelete ? actions.filter((action) => !action.type.startsWith("delete_")) : actions,
    allActions: actions,
    massDelete,
    deleteLocal,
    deleteRemote,
  };
}

export function fullySyncedIds(pair, local, remote, base = pair.base || {}) {
  const fileIds = new Set();
  const folderIds = new Set();
  const filePaths = new Map();
  const folderPaths = new Map();
  const localPending = new Set(local.pending || []);
  const remotePending = new Set(remote.pending || []);
  const errorPaths = new Set();
  for (const error of pair.errors || []) {
    const value = String(error.path || "").replace(/\\/g, "/");
    if (!value) continue;
    const rel = isAbsolute(value) ? relative(resolve(pair.local), resolve(value)) : value;
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) errorPaths.add("");
    else errorPaths.add(rel.split(sep).join("/").replace(/^\.\//, ""));
  }

  for (const [path, remoteFile] of Object.entries(remote.files || {})) {
    const localFile = local.files?.[path];
    const prior = base.files?.[path];
    const hashesMatch = !!remoteFile.sha256 && !!localFile?.sha256 && localFile.sha256 === remoteFile.sha256;
    // Legacy course uploads may not have a Drive hash yet. Pull records the
    // downloaded file id, local hash and size; that base plus matching sizes
    // is the available confirmation until Drive hashes the remote bytes.
    const pullBaseMatches = pair.mode === "pull" && !remoteFile.sha256
      && prior?.file_id === remoteFile.file_id && !!prior.sha256 && !!localFile?.sha256
      && localFile.sha256 === prior.sha256
      && Number(localFile.size) === Number(remoteFile.size)
      && Number(prior.size) === Number(remoteFile.size);
    if (!remoteFile.file_id || (!hashesMatch && !pullBaseMatches)
      || localPending.has(path) || (remotePending.has(path) && !pullBaseMatches)
      || errorPaths.has("") || errorPaths.has(path)) continue;
    fileIds.add(remoteFile.file_id);
    filePaths.set(path, remoteFile.file_id);
  }

  const folderIsSynced = (folderPath) => {
    const within = (path) => !folderPath || path.startsWith(`${folderPath}/`);
    if ([...localPending, ...errorPaths].some((path) => !path || within(path))) return false;
    const paths = new Set([
      ...Object.keys(local.files || {}).filter(within),
      ...Object.keys(remote.files || {}).filter(within),
    ]);
    for (const path of paths) {
      if (!fileIds.has(remote.files?.[path]?.file_id)) return false;
    }
    return true;
  };

  for (const [path, id] of Object.entries(remote.folders || {})) {
    if (folderIsSynced(path)) {
      folderIds.add(id);
      folderPaths.set(path, id);
    }
  }
  if (pair.folder_id && folderIsSynced("")) {
    folderIds.add(pair.folder_id);
    folderPaths.set("", pair.folder_id);
  }
  return { fileIds, folderIds, filePaths, folderPaths };
}

const stableJSON = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);

export function createFolderSync({
  dataDir,
  driveDir,
  getRows,
  syncOnce,
  upload,
  download,
  removeLocal,
  maxFile = async () => Infinity,
  deviceName = () => "PC",
  signedIn = () => true,
  onState = () => {},
  onPairAdded = () => {},
  onPassComplete = () => {},
  onStarted = () => {},
  watchFactory = watch,
  // Recursive fs.watch handles normal local edits immediately. Keep a slower
  // full scan as recovery for dropped or unsupported filesystem notifications.
  intervalMs = 5 * 60 * 1000,
  clock = () => Date.now(),
  deferStart = false,
}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "syncfolders.json");
  const pairs = new Map();
  const timers = new Map();
  const watchers = new Map();
  const running = new Set();
  const settling = new Map();
  let stopped = false;
  let started = false;
  let syncStateCache = { file_ids: [], folder_ids: [] };
  let coveredFileIds = new Set();

  function valuesOf(value) {
    if (value instanceof Map || value instanceof Set) return value.values();
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function rebuildSyncStateCache() {
    const fileIds = new Set();
    const folderIds = new Set();
    const covered = new Set();
    const rows = getRows();
    for (const pair of pairs.values()) {
      for (const id of valuesOf(pair.syncedFilePaths)) covered.add(id);
      for (const entry of Object.values(pair.base?.files || {})) if (entry?.file_id) covered.add(entry.file_id);
      for (const row of rows.files || []) if (fileBelongsToPair(pair, row, rows.folders || [])) covered.add(row.id);
      if (pair.paused) continue;
      for (const id of valuesOf(pair.syncedFileIds)) fileIds.add(id);
      for (const id of valuesOf(pair.syncedFolderIds)) folderIds.add(id);
    }
    coveredFileIds = covered;
    syncStateCache = { file_ids: [...fileIds], folder_ids: [...folderIds] };
  }

  function load() {
    try {
      for (const pair of JSON.parse(readFileSync(file, "utf8"))) {
        pairs.set(pair.id, {
          ...pair,
          mode: pair.mode === "pull" ? "pull" : "two-way",
          course_id: pair.course_id || null,
          errors: [],
          state: pair.paused ? "paused" : "idle",
          last_sync: pair.last_sync || null,
          syncedFileIds: new Set(),
          syncedFolderIds: new Set(),
          syncedFilePaths: new Map(),
          syncedFolderPaths: new Map(),
          localFileStats: new Map(),
          directoryContents: new Map(),
        });
      }
    } catch {}
  }

  function save() {
    const tmp = file + ".part";
    const saved = [...pairs.values()].map(({
      errors, state, pending,
      syncedFileIds, syncedFolderIds, syncedFilePaths, syncedFolderPaths,
      localFileStats, directoryContents,
      ...pair
    }) => pair);
    writeFileSync(tmp, JSON.stringify(saved, (_key, value) =>
      value instanceof Map || value instanceof Set ? undefined : value, 2) + "\n");
    renameSync(tmp, file);
  }

  // folderPath scans every row, and view() runs on every progress emit: on a
  // 5,000-file pair that scan was the whole of the sidecar's CPU. Remember the
  // answer for the pass.
  const folderPaths = new Map();

  function folderPath(id) {
    if (folderPaths.has(id)) return folderPaths.get(id);
    const rows = getRows().folders || [];
    const course = (getRows().courses || []).find((row) => row.id === id);
    const path = course ? `Drive/${course.name}` : (() => {
      const names = [];
      const seen = new Set();
      let folder = rows.find((row) => row.id === id);
      while (folder && !seen.has(folder.id)) {
        seen.add(folder.id);
        names.unshift(folder.name);
        folder = rows.find((row) => row.id === folder.parent_id);
      }
      return ["Drive", ...names].join("/");
    })();
    folderPaths.set(id, path);
    return path;
  }

  function view(pair) {
    // The guard counts folders too. The prompt needs the number of files
    // and where they disappeared, rather than the total pending work.
    const actions = pair.pendingDeletes?.actions || [];
    const deleteRemote = actions.filter(action => action.type === "delete_remote").length;
    const deleteLocal = actions.filter(action => action.type === "delete_local").length;
    const fromPC = actions.some(action => action.type === "delete_remote" || action.type === "delete_remote_folder");
    const fromDrive = actions.some(action => action.type === "delete_local" || action.type === "delete_local_folder");
    return {
      id: pair.id,
      local: pair.local,
      folder_id: pair.folder_id,
      mode: pair.mode || "two-way",
      course_id: pair.course_id || null,
      folder_path: folderPath(pair.folder_id),
      state: pair.state,
      reason: pair.reason || null,
      last_sync: pair.last_sync,
      pending: pair.pending || 0,
      errors: pair.errors || [],
      paused: !!pair.paused,
      files_done: pair.files_done || 0,
      files_total: pair.files_total || 0,
      bytes_done: pair.bytes_done || 0,
      bytes_total: pair.bytes_total || 0,
      delete_count: deleteRemote + deleteLocal,
      delete_side: fromPC && fromDrive ? "this PC and Drive" : fromDrive ? "Drive" : "this PC",
    };
  }

  // Progress goes out per file, and view() costs a little; the window shows a
  // badge, not every byte. A change of state always goes out at once.
  function emit(pair) {
    const now = clock();
    if (pair._emitState === pair.state && now - (pair._emitAt || 0) < 250) return;
    pair._emitAt = now;
    pair._emitState = pair.state;
    onState(view(pair));
  }

  function runQueuedResolution() {
    if (running.size) return;
    const pair = [...pairs.values()].find((item) => item.queuedResolution);
    if (!pair) return;
    const resolution = pair.queuedResolution;
    delete pair.queuedResolution;
    queueMicrotask(() => command(pair.id, resolution));
  }

  function schedule(pair, delay = 2000) {
    if (stopped || !started) return;
    clearTimeout(timers.get(pair.id));
    timers.set(pair.id, setTimeout(() => run(pair.id), delay));
  }

  function startWatch(pair) {
    if (!started || stopped) return;
    try {
      watchers.get(pair.id)?.close();
      async function unchangedFilesystemEvent(path) {
        const key = path.toLowerCase();
        if (path) {
          const prior = pair.localFileStats?.get(key);
          if (prior) {
            try {
              const current = await stat(join(pair.local, ...path.split("/")));
              return current.size === prior.size && current.mtimeMs === prior.mtimeMs;
            } catch { return false; }
          }
          const contents = pair.directoryContents?.get(key);
          if (contents) {
            try {
              const entries = await readdir(join(pair.local, ...path.split("/")), { withFileTypes: true });
              const current = entries
                .filter((entry) => !ignored(entry.name) && (entry.isFile() || entry.isDirectory())
                  && !within(driveDir, join(pair.local, ...path.split("/"), entry.name)))
                .map((entry) => entry.name.toLowerCase())
                .sort();
              return current.length === contents.length && current.every((name, index) => name === contents[index]);
            } catch { return false; }
          }
          return false;
        }

        // A null filename can mean the watcher overflowed. Only ignore it if
        // the full content snapshot still matches, including file mtimes.
        const rootContents = pair.directoryContents?.get("");
        if (!rootContents) return false;
        try {
          const entries = await readdir(pair.local, { withFileTypes: true });
          const current = entries
            .filter((entry) => !ignored(entry.name) && (entry.isFile() || entry.isDirectory())
              && !within(driveDir, join(pair.local, entry.name)))
            .map((entry) => entry.name.toLowerCase())
            .sort();
          if (current.length !== rootContents.length || !current.every((name, index) => name === rootContents[index])) return false;
          for (const [relativePath, prior] of pair.localFileStats || []) {
            const item = await stat(join(pair.local, ...relativePath.split("/"))).catch(() => null);
            if (!item || item.size !== prior.size || item.mtimeMs !== prior.mtimeMs) return false;
          }
          return true;
        } catch { return false; }
      }
      const watcher = watchFactory(pair.local, { recursive: true }, (_event, filename) => {
        const path = filename == null ? "" : String(filename).replace(/\\/g, "/").replace(/^\.\//, "");
        void unchangedFilesystemEvent(path).then((unchanged) => {
          if (unchanged || stopped || !pairs.has(pair.id)) return;
          if (!path) {
            pair.syncedFilePaths = new Map();
            pair.syncedFolderPaths = new Map();
          } else {
            const knownFiles = pair.syncedFilePaths || new Map();
            const knownFolders = pair.syncedFolderPaths || new Map();
            const directory = knownFolders.has(path)
              || [...knownFiles.keys(), ...knownFolders.keys()].some((item) => item.startsWith(`${path}/`));
            for (const item of knownFiles.keys()) {
              if (item === path || (directory && item.startsWith(`${path}/`))) knownFiles.delete(item);
            }
            for (const item of knownFolders.keys()) {
              const ancestor = !item || path === item || path.startsWith(`${item}/`);
              if (ancestor || (directory && item.startsWith(`${path}/`))) knownFolders.delete(item);
            }
            pair.syncedFilePaths = knownFiles;
            pair.syncedFolderPaths = knownFolders;
          }
          pair.syncedFileIds = new Set(pair.syncedFilePaths?.values() || []);
          pair.syncedFolderIds = new Set(pair.syncedFolderPaths?.values() || []);
          rebuildSyncStateCache();
          schedule(pair, 2000);
        }).catch(() => schedule(pair, 2000));
      });
      watcher.on("error", (error) => pause(pair, "root_unreadable", error.message));
      watchers.set(pair.id, watcher);
    } catch (error) {
      pause(pair, "root_unreadable", error.message);
    }
  }

  function pause(pair, reason, message) {
    pair.paused = true;
    pair.reason = reason;
    pair.state = "paused";
    pair.errors = message ? [{ path: pair.local, error: message }] : [];
    watchers.get(pair.id)?.close();
    watchers.delete(pair.id);
    save();
    emit(pair);
    rebuildSyncStateCache();
  }

  async function scan(root, prior = {}) {
    const files = {};
    const folders = {};
    const directoryContents = new Map();
    const pending = [];

    async function walk(directory, relPath = "") {
      const entries = await readdir(directory, { withFileTypes: true });
      directoryContents.set(relPath.toLowerCase(), entries
        .filter((entry) => !ignored(entry.name) && (entry.isFile() || entry.isDirectory())
          && !within(driveDir, join(directory, entry.name)))
        .map((entry) => entry.name.toLowerCase())
        .sort());
      for (const entry of entries) {
        if (ignored(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const path = relPath ? `${relPath}/${entry.name}` : entry.name;
        if (within(driveDir, absolute)) continue;

        if (entry.isDirectory()) {
          folders[path] = null;
          await walk(absolute, path);
          continue;
        }
        if (!entry.isFile()) continue;

        const before = await stat(absolute);
        const old = prior.files?.[path];
        let sha256;
        if (old && old.mtime === before.mtimeMs && old.size === before.size) {
          sha256 = old.sha256;
        } else {
          const key = `${root}\0${path}`;
          const seen = settling.get(key);
          if (seen?.size === before.size && seen.mtime === before.mtimeMs && seen.sha256) {
            sha256 = seen.sha256;
          } else if (!seen || seen.size !== before.size || seen.mtime !== before.mtimeMs) {
            settling.set(key, { size: before.size, mtime: before.mtimeMs });
            pending.push(path);
            continue;
          } else {
            sha256 = await hashFile(absolute);
            const after = await stat(absolute);
            if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
              settling.set(key, { size: after.size, mtime: after.mtimeMs });
              pending.push(path);
              continue;
            }
            settling.set(key, { size: before.size, mtime: before.mtimeMs, sha256 });
          }
        }

        files[path] = {
          path: absolute,
          sha256,
          mtime: before.mtimeMs,
          size: before.size,
        };
      }
    }

    await walk(root);
    return { files, folders, pending, directoryContents };
  }

  function remoteTree(folderId, courseId = null) {
    const rows = getRows();
    const folders = {};
    const files = {};
    const pending = [];
    const allFolders = rows.folders || [];
    const allFiles = rows.files || [];

    // Course files are stored with course_id rather than a folder_id. They
    // still use the same planner and local tree as ordinary folder pairs.
    const courseFiles = courseId && allFiles.some((item) => item.course_id === courseId)
      ? allFiles.filter((item) => item.course_id === courseId && !item.deleted)
      : null;
    if (courseFiles) {
      for (const row of courseFiles) {
        let parent = row.folder_id;
        const parts = [row.name];
        const seen = new Set();
        const chain = [];
        while (parent && !seen.has(parent)) {
          seen.add(parent);
          const folder = allFolders.find((item) => item.id === parent && !item.deleted);
          if (!folder) break;
          chain.unshift(folder);
          parent = folder.parent_id;
        }
        for (let i = 0; i < chain.length; i++) folders[chain.slice(0, i + 1).map((item) => item.name).join("/")] = chain[i].id;
        if (chain.length) parts.unshift(...chain.map((item) => item.name));
        const path = parts.join("/");
        if (!row.sha256) pending.push(path);
        files[path] = { file_id: row.id, sha256: row.sha256 || "", size: row.size, updated_at: row.updated_at, folder_id: row.folder_id, name: row.name };
      }
      return { files, folders, pending };
    }

    function descend(parentId, prefix) {
      for (const folder of allFolders.filter((row) =>
        (row.parent_id || null) === (parentId || null) && !row.deleted)) {
        const path = prefix ? `${prefix}/${folder.name}` : folder.name;
        folders[path] = folder.id;
        descend(folder.id, path);
      }
    }

    descend(folderId, "");
    for (const row of allFiles.filter((item) => !item.deleted)) {
      let parent = row.folder_id;
      const parts = [row.name];
      const seen = new Set();
      while (parent && parent !== folderId && !seen.has(parent)) {
        seen.add(parent);
        const folder = allFolders.find((item) => item.id === parent && !item.deleted);
        if (!folder) break;
        parts.unshift(folder.name);
        parent = folder.parent_id;
      }
      if (parent !== folderId) continue;

      const path = parts.join("/");
      if (!row.sha256) pending.push(path);
      files[path] = {
        file_id: row.id,
        sha256: row.sha256 || "",
        size: row.size,
        updated_at: row.updated_at,
        folder_id: row.folder_id,
        name: row.name,
      };
    }
    return { files, folders, pending };
  }

  async function ensureFolders(pair, path) {
    const names = path.split("/").slice(0, -1);
    let parent = pair.folder_id;
    const rows = getRows();
    for (const name of names) {
      let folder = (rows.folders || []).find((row) =>
        row.name === name && (row.parent_id || null) === (parent || null) && !row.deleted);
      if (!folder) {
        folder = rows.createFolder(name, parent);
        await syncOnce();
      }
      parent = folder.id;
    }
    return parent;
  }

  // The server's limit changes only when it is redeployed, and a pull copy asks
  // once per file: keep the answer for a minute instead of a request per file.
  let maxFileCache = { at: 0, value: Infinity };
  async function currentMaxFile() {
    if (Date.now() - maxFileCache.at < 60_000) return maxFileCache.value;
    const value = await maxFile();
    maxFileCache = { at: Date.now(), value: Number.isFinite(value) ? value : Infinity };
    return maxFileCache.value;
  }

  async function uploadAction(pair, action) {
    const path = action.path;
    const item = action.local;
    const size = (await stat(item.path)).size;
    const max = await currentMaxFile();
    if (size > max) {
      pair.errors.push({ path, error: `File is over the ${Math.round(max / 1048576)} MB upload limit.` });
      return null;
    }

    const folderId = await ensureFolders(pair, path);
    const remoteFile = remoteTree(pair.folder_id).files[path];
    return upload(item.path, {
      name: basename(path),
      folder_id: folderId,
      existing: remoteFile?.file_id || action.remote?.file_id,
    });
  }

  async function downloadAction(pair, action, local) {
    const max = await currentMaxFile();
    if (Number.isFinite(max) && Number(action.remote.size) > max) {
      pair.errors.push({ path: action.path, error: `File is over the ${Math.round(max / 1048576)} MB download limit.` });
      return null;
    }
    const target = join(pair.local, ...action.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    const part = target + ".part";
    await download(action.remote.file_id, part);

    let current;
    try {
      current = await stat(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const scanned = local.files[action.path];
    const changedDuringDownload = scanned
      ? !current || current.mtimeMs !== scanned.mtime || current.size !== scanned.size
      : !!current;
    if (changedDuringDownload) {
      const name = conflictName(action.path, deviceName(), new Date(clock()));
      const conflict = join(dirname(target), name);
      await rename(part, conflict);
      return conflict;
    }

    await rename(part, target);
    return target;
  }

  function remoteFolderHasContent(folderId) {
    const rows = getRows();
    const folders = rows.folders || [];
    const files = rows.files || [];
    const descendants = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        if (!folder.deleted && descendants.has(folder.parent_id) && !descendants.has(folder.id)) {
          descendants.add(folder.id);
          grew = true;
        }
      }
    }
    return folders.some((folder) => !folder.deleted && folder.id !== folderId && descendants.has(folder.id))
      || files.some((row) => !row.deleted && descendants.has(row.folder_id));
  }

  async function localFolderWillBeEmpty(pair, folderPath, fileDeletes, folderDeletes) {
    const absolute = join(pair.local, ...folderPath.split("/"));
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    }

    for (const entry of entries) {
      // desktop.ini and Thumbs.db go to the Recycle Bin with their folder.
      if (ignored(entry.name)) continue;
      const child = join(absolute, entry.name);
      const rel = relative(pair.local, child).split(sep).join("/");
      if (entry.isFile() && fileDeletes.has(rel)) continue;
      if (entry.isDirectory() && folderDeletes.has(rel)
        && await localFolderWillBeEmpty(pair, rel, fileDeletes, folderDeletes)) continue;
      return false;
    }
    return true;
  }

  async function processFolderDeletes(pair, actions, localFileDeletes) {
    const localFolderDeletes = new Set(actions
      .filter((action) => action.type === "delete_local_folder")
      .map((action) => action.path));
    const folders = actions
      .filter((action) => action.type === "delete_remote_folder" || action.type === "delete_local_folder")
      .sort((a, b) => b.path.split("/").length - a.path.split("/").length);
    const recycle = localFileDeletes.map((path) => join(pair.local, ...path.split("/")));

    for (const action of folders) {
      if (action.type === "delete_remote_folder") {
        const currentPath = remoteTree(pair.folder_id, pair.mode === "pull" ? pair.course_id : null).folders[action.path];
        if (currentPath !== action.folder_id || remoteFolderHasContent(currentPath)) continue;
        getRows().removeFolder?.(currentPath);
        continue;
      }

      if (remoteTree(pair.folder_id, pair.mode === "pull" ? pair.course_id : null).folders[action.path]) continue;
      if (await localFolderWillBeEmpty(pair, action.path, new Set(localFileDeletes), localFolderDeletes)) {
        recycle.push(join(pair.local, ...action.path.split("/")));
      }
    }

    if (recycle.length) await removeLocal(recycle);
  }

  async function run(id) {
    const pair = pairs.get(id);
    if (stopped || !started || !pair || pair.paused || running.has(id)) return;
    if (running.size) {
      schedule(pair, 250);
      return;
    }
    running.add(id);
    pair.state = "syncing";
    rebuildSyncStateCache();
    folderPaths.delete(pair.folder_id);
    pair.errors = [];
    pair.pending = 0;
    emit(pair);

    try {
      if (!existsSync(pair.local)) {
        throw Object.assign(new Error("The synced folder is missing or unreadable."), { pause: "root_unreadable" });
      }
      await readdir(pair.local).catch((error) => {
        throw Object.assign(error, { pause: "root_unreadable" });
      });
      if (!signedIn()) {
        pair.state = "idle";
        return;
      }
      const courseExists = pair.mode === "pull" && pair.course_id
        && (getRows().courses || []).some((course) => course.id === pair.course_id && !course.archived);
      const folderExists = (getRows().folders || []).some((folder) => folder.id === pair.folder_id && !folder.deleted);
      if (!(courseExists || folderExists)) {
        throw Object.assign(new Error("The paired Drive folder is missing."), { pause: "drive_folder_missing" });
      }

      const local = await scan(pair.local, pair.base || {});
      const remoteForPair = () => remoteTree(pair.folder_id, pair.mode === "pull" ? pair.course_id : null);
      let remote = remoteForPair();
      // Folders made on Drive come down; one deleted here since the last pass
      // is left out, so it can be deleted on Drive instead of coming back.
      for (const folder of Object.keys(remote.folders)) {
        if (pair.base?.folders?.[folder] && !Object.hasOwn(local.folders, folder)) continue;
        await mkdir(join(pair.local, ...folder.split("/")), { recursive: true });
      }

      const stable = new Set(Object.keys(local.files));
      const plan = compareTrees(local, remote, pair.base || {}, {
        device: deviceName(),
        stable,
        pending: new Set(local.pending),
        pendingRemote: new Set(remote.pending),
        mode: pair.mode || "two-way",
      });
      if (plan.massDelete) {
        pair.pending = plan.allActions.length;
        pair.pendingDeletes = { ...plan, actions: plan.allActions };
        pause(pair, "mass_delete");
        return;
      }

      pair.pending = plan.actions.length;
      pair.files_done = 0;
      pair.files_total = plan.actions.filter((a) => ["download", "pull_conflict", "upload", "delete_local"].includes(a.type)).length;
      pair.bytes_done = 0;
      pair.bytes_total = plan.actions.filter((a) => a.type === "download" || a.type === "pull_conflict")
        .reduce((n, a) => n + (Number(a.remote?.size) || 0), 0);
      const localFileDeletes = [];
      for (const action of plan.actions) {
        if (!pairs.has(id) || pair.paused) return;
        // One file the server refuses, or a connection that drops mid-upload,
        // must not hold back everything after it: note it, go on, retry next
        // pass. Only a missing or unreadable root pauses the whole pair.
        try {
          if (action.type === "download") {
            const downloaded = await downloadAction(pair, action, local);
            if (downloaded) pair.bytes_done += Number(action.remote?.size) || 0;
          } else if (action.type === "pull_conflict") {
            const conflict = join(dirname(join(pair.local, ...action.path.split("/"))), action.conflict);
            await mkdir(dirname(conflict), { recursive: true });
            const downloaded = await downloadAction(pair, { ...action, path: relative(pair.local, conflict).split(sep).join("/") }, { files: {} });
            if (downloaded) {
              const localVersion = await stat(join(pair.local, ...action.path.split("/")));
              pair.base.files ||= {};
              pair.base.files[action.path] = {
                file_id: action.remote.file_id, sha256: action.remote.sha256,
                mtime: localVersion.mtimeMs, size: localVersion.size,
                ...(action.local_only || pair.base.files[action.path]?.local_only ? { local_only: true } : {}),
              };
              pair.bytes_done += Number(action.remote?.size) || 0;
            }
          } else if (action.type === "upload") {
            await uploadAction(pair, action);
          } else if (action.type === "remote_move") {
            const from = join(pair.local, ...action.from.split("/"));
            const to = join(pair.local, ...action.path.split("/"));
            await mkdir(dirname(to), { recursive: true });
            await rename(from, to);
            const baseFile = pair.base.files?.[action.from];
            if (baseFile) {
              delete pair.base.files[action.from];
              pair.base.files[action.path] = baseFile;
              save();
            }
          } else if (action.type === "local_move") {
            const folderId = await ensureFolders(pair, action.path);
            const row = (getRows().files || []).find((file) => file.id === action.file_id);
            if (row) getRows().moveFile?.(row.id, basename(action.path), folderId);
          } else if (action.type === "conflict") {
            const from = local.files[action.path].path;
            const to = join(dirname(from), action.conflict);
            await rename(from, to);
            if (pair.base.files?.[action.path]) {
              delete pair.base.files[action.path];
              save();
            }
            const conflictPath = relative(pair.local, to).split(sep).join("/");
            await uploadAction(pair, {
              path: conflictPath,
              local: { ...local.files[action.path], path: to },
            });
            await downloadAction(pair, { path: action.path, remote: action.remote }, { files: {} });
          } else if (action.type === "delete_remote") {
            const row = (getRows().files || []).find((item) => item.id === action.file_id);
            if (row) getRows().removeFile?.(row.id);
          } else if (action.type === "delete_local") {
            localFileDeletes.push(action.path);
          }
        } catch (error) {
          pair.errors.push({ path: action.path, error: error.message });
        }
        pair.pending--;
        if (["download", "pull_conflict", "delete_local", "upload"].includes(action.type)) pair.files_done++;
        emit(pair);
      }

      if (!pairs.has(id)) return;
      // Make new empty local directories on Drive after file changes are applied.
      for (const folder of Object.keys(local.folders)) {
        if (pair.mode === "pull") break;
        if (!folder || pair.base.folders?.[folder] || remote.folders[folder]) continue;
        await ensureFolders(pair, `${folder}/_folder`);
      }
      await syncOnce();
      await processFolderDeletes(pair, plan.actions, localFileDeletes);
      await syncOnce();

      const afterLocal = await scan(pair.local, pair.base || {});
      remote = remoteForPair();
      const base = { files: {}, folders: { ...remote.folders } };
      for (const [path, localFile] of Object.entries(afterLocal.files)) {
        const remoteFile = remote.files[path];
        // A pull copy has to download files the server has not hashed yet (it
        // backfills them over time). Remember the pair by size until then, or
        // every pass would download them again.
        if (remoteFile && !remoteFile.sha256) {
          if (pair.mode === "pull" && Number(remoteFile.size) === Number(localFile.size)) {
            base.files[path] = { file_id: remoteFile.file_id, sha256: localFile.sha256 || "", mtime: localFile.mtime, size: localFile.size };
          }
          continue;
        }
        if (remoteFile && localFile.sha256 === remoteFile.sha256) {
          base.files[path] = {
            file_id: remoteFile.file_id,
            sha256: remoteFile.sha256,
            mtime: localFile.mtime,
            size: localFile.size,
          };
        } else if (pair.base?.files?.[path]) {
          base.files[path] = pair.base.files[path];
        }
      }
      const baseChanged = stableJSON(base) !== stableJSON(pair.base || {});
      pair.base = base;
      const synced = fullySyncedIds(pair, afterLocal, remote, base);
      pair.syncedFileIds = synced.fileIds;
      pair.syncedFolderIds = synced.folderIds;
      pair.syncedFilePaths = synced.filePaths;
      pair.syncedFolderPaths = synced.folderPaths;
      pair.localFileStats = new Map(Object.entries(afterLocal.files).map(([path, item]) => [
        path.toLowerCase(), { size: item.size, mtimeMs: item.mtime },
      ]));
      pair.directoryContents = afterLocal.directoryContents;
      pair.last_sync = clock();
      pair.state = pair.errors.length ? "error" : "idle";
      pair.reason = null;
      if (baseChanged) save();
      rebuildSyncStateCache();
      if (local.pending.length || afterLocal.pending.length) schedule(pair, 2000);
    } catch (error) {
      pair.pending = 0;
      // A file that vanished or was locked mid-pass is retried next pass; only
      // a missing or unreadable root pauses the pair.
      const rootGone = ["ENOENT", "EACCES", "EPERM"].includes(error.code) && !existsSync(pair.local);
      if (error.pause || rootGone) {
        pause(pair, error.pause || "root_unreadable", error.message);
      } else {
        pair.syncedFileIds = new Set();
        pair.syncedFolderIds = new Set();
        pair.syncedFilePaths = new Map();
        pair.syncedFolderPaths = new Map();
        pair.localFileStats = new Map();
        pair.directoryContents = new Map();
        pair.state = "error";
        pair.errors = [{ path: pair.local, error: error.message }];
        emit(pair);
        rebuildSyncStateCache();
      }
    } finally {
      running.delete(id);
      emit(pair);
      runQueuedResolution();
      Promise.resolve(onPassComplete(pair)).catch(() => {});
    }
  }

  function finishGuard(pair, resolution) {
    if (running.has(pair.id)) {
      pair.queuedResolution = resolution;
      return;
    }
    running.add(pair.id);
    pair.state = "syncing";
    emit(pair);
    startWatch(pair);
    Promise.resolve(onPairAdded(pair)).catch(() => {});
    const actions = pair.pendingDeletes?.actions || [];
    const localFileDeletes = [];

    const apply = async () => {
      for (const action of actions) {
        if (resolution === "confirm" && action.type === "delete_remote") {
          getRows().removeFile?.(action.file_id);
        } else if (resolution === "confirm" && action.type === "delete_local") {
          localFileDeletes.push(action.path);
        } else if (resolution === "keep" && action.type === "delete_remote") {
          await downloadAction(pair, { path: action.path, remote: action.remote }, { files: {} });
        } else if (resolution === "keep" && action.type === "delete_local") {
          await uploadAction(pair, { path: action.path, local: action.local });
        } else if (resolution === "keep" && action.type === "delete_remote_folder") {
          await mkdir(join(pair.local, ...action.path.split("/")), { recursive: true });
        } else if (resolution === "keep" && action.type === "delete_local_folder") {
          await ensureFolders(pair, `${action.path}/_folder`);
        }
      }
      await syncOnce();
      if (resolution === "confirm") await processFolderDeletes(pair, actions, localFileDeletes);
      await syncOnce();
      pair.base = { files: {}, folders: {} };
      delete pair.pendingDeletes;
      pair.paused = false;
      pair.state = "idle";
      save();
    };
    apply().catch((error) => {
      pair.state = "error";
      pair.errors = [{ path: pair.local, error: error.message }];
    }).finally(() => {
      running.delete(pair.id);
      emit(pair);
      runQueuedResolution();
      if (pairs.has(pair.id) && !pair.paused) run(pair.id);
    });
  }

  function add(local, folderId) {
    const pair = {
      id: randomUUID(),
      local: resolve(local),
      folder_id: folderId,
      paused: false,
      base: { files: {}, folders: {} },
      state: "idle",
      errors: [],
      last_sync: null,
      mode: "two-way",
      course_id: null,
      localFileStats: new Map(),
      directoryContents: new Map(),
    };
    pairs.set(pair.id, pair);
    rebuildSyncStateCache();
    save();
    startWatch(pair);
    Promise.resolve(onPairAdded(pair)).catch(() => {});
    if (running.size) schedule(pair, 2000);
    else run(pair.id);
    return view(pair);
  }

  function addPull(folderId, localRoot, courseId = folderId) {
    const existing = [...pairs.values()].find((pair) => pair.mode === "pull" && pair.course_id === courseId);
    if (existing) return view(existing);
    const pair = {
      id: randomUUID(), local: resolve(localRoot), folder_id: folderId, course_id: courseId,
      mode: "pull", paused: false, base: { files: {}, folders: {} }, state: "idle", errors: [], last_sync: null,
      localFileStats: new Map(), directoryContents: new Map(),
    };
    pairs.set(pair.id, pair);
    rebuildSyncStateCache();
    mkdirSync(pair.local, { recursive: true });
    save();
    startWatch(pair);
    if (running.size) schedule(pair, 2000); else run(pair.id);
    return view(pair);
  }

  function command(id, action) {
    const pair = pairs.get(id);
    if (!pair) return null;
    if ((action === "confirm" || action === "keep") && running.size) {
      pair.queuedResolution = action;
      return view(pair);
    }

    if (action === "pause") {
      pause(pair, "user");
    } else if (action === "resume") {
      pair.paused = false;
      pair.reason = null;
      startWatch(pair);
      run(id);
    } else if (action === "now") {
      run(id);
    } else if (action === "confirm" || action === "keep") {
      pair.paused = false;
      pair.reason = null;
      const savedActions = pair.pendingDeletes?.actions;
      if (savedActions) finishGuard(pair, action);
      else run(id);
    }
    return view(pair);
  }

  function remove(id) {
    const pair = pairs.get(id);
    if (!pair) return false;
    watchers.get(id)?.close();
    clearTimeout(timers.get(id));
    pairs.delete(id);
    save();
    rebuildSyncStateCache();
    return true;
  }

  function relocatePull(id, localRoot) {
    const pair = pairs.get(id);
    if (!pair || pair.mode !== "pull") return false;
    watchers.get(id)?.close();
    watchers.delete(id);
    clearTimeout(timers.get(id));
    timers.delete(id);
    pair.local = resolve(localRoot);
    pair.syncedFileIds = new Set();
    pair.syncedFolderIds = new Set();
    save();
    if (started && !pair.paused) startWatch(pair);
    rebuildSyncStateCache();
    return true;
  }

  function start() {
    if (stopped || started) return;
    started = true;
    for (const pair of pairs.values()) {
      if (!pair.paused) startWatch(pair);
    }
    Promise.resolve(onStarted([...pairs.values()])).catch(() => {});
  }

  function syncState() {
    return syncStateCache;
  }

  load();
  rebuildSyncStateCache();
  if (!deferStart) start();

  const interval = setInterval(() => {
    for (const pair of pairs.values()) schedule(pair, 0);
  }, intervalMs);
  interval.unref?.();

  return {
    list: () => [...pairs.values()].map(view),
    add,
    addPull,
    command,
    remove,
    run,
    schedule: (id, delay = 2000) => {
      const pair = pairs.get(id);
      if (pair) schedule(pair, delay);
    },
    relocatePull,
    localPathForFile: (id) => {
      for (const pair of pairs.values()) {
        const found = mapPairFilePath(pair, id);
        if (found) return { ...found, pair: view(pair) };
      }
      return null;
    },
    matchingLocalPathForFile: async (id, row) => {
      for (const pair of pairs.values()) {
        if (pair.paused || pair.state === "syncing") continue;
        const found = await mapPairFile(pair, id, row);
        if (found) return { ...found, pair: view(pair) };
      }
      return null;
    },
    coversFile: (id) => coveredFileIds.has(id),
    localPathForFolder: (id) => {
      for (const pair of pairs.values()) {
        const found = mapPairFolder(pair, id);
        if (found) return { ...found, pair: view(pair) };
      }
      return null;
    },
    syncState,
    start,
    stop: () => {
      stopped = true;
      clearInterval(interval);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers.values()) watcher.close();
    },
  };
}
