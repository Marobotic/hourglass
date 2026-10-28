import { createHash, randomUUID } from "node:crypto";
import { watch, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

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

  for (const path of filePaths) {
    if (consumed.has(path) || pending.has(path) || pendingRemote.has(path)) continue;

    const localFile = localFiles[path];
    const remoteFile = remoteFiles[path];
    const baseFile = baseFiles[path];

    if (!baseFile) {
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
      actions.push({ type: "delete_remote_folder", path, folder_id: remoteFolders[path] });
      deleteRemote++;
    } else {
      actions.push({ type: "delete_local_folder", path, folder_id: baseFolders[path] });
      deleteLocal++;
    }
  }

  const baseCount = Math.max(Object.keys(baseFiles).length, 1);
  const massDelete = deleteLocal > maxDeletes
    || deleteRemote > maxDeletes
    || (deleteLocal >= 5 && deleteLocal / baseCount > 0.25)
    || (deleteRemote >= 5 && deleteRemote / baseCount > 0.25);

  return {
    actions: massDelete ? actions.filter((action) => !action.type.startsWith("delete_")) : actions,
    allActions: actions,
    massDelete,
    deleteLocal,
    deleteRemote,
  };
}

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
  watchFactory = watch,
  clock = () => Date.now(),
}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "syncfolders.json");
  const pairs = new Map();
  const timers = new Map();
  const watchers = new Map();
  const running = new Set();
  const settling = new Map();
  let stopped = false;

  function load() {
    try {
      for (const pair of JSON.parse(readFileSync(file, "utf8"))) {
        pairs.set(pair.id, {
          ...pair,
          errors: [],
          state: pair.paused ? "paused" : "idle",
          last_sync: pair.last_sync || null,
        });
      }
    } catch {}
  }

  function save() {
    const tmp = file + ".part";
    const saved = [...pairs.values()].map(({ errors, state, pending, ...pair }) => pair);
    writeFileSync(tmp, JSON.stringify(saved, null, 2) + "\n");
    renameSync(tmp, file);
  }

  function folderPath(id) {
    const rows = getRows().folders || [];
    const names = [];
    const seen = new Set();
    let folder = rows.find((row) => row.id === id);
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      names.unshift(folder.name);
      folder = rows.find((row) => row.id === folder.parent_id);
    }
    return ["Drive", ...names].join("/");
  }

  function view(pair) {
    return {
      id: pair.id,
      local: pair.local,
      folder_id: pair.folder_id,
      folder_path: folderPath(pair.folder_id),
      state: pair.state,
      reason: pair.reason || null,
      last_sync: pair.last_sync,
      pending: pair.pending || 0,
      errors: pair.errors || [],
    };
  }

  function emit(pair) {
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
    if (stopped) return;
    clearTimeout(timers.get(pair.id));
    timers.set(pair.id, setTimeout(() => run(pair.id), delay));
  }

  function startWatch(pair) {
    try {
      watchers.get(pair.id)?.close();
      const watcher = watchFactory(pair.local, { recursive: true }, () => schedule(pair, 2000));
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
  }

  async function scan(root, prior = {}) {
    const files = {};
    const folders = {};
    const pending = [];

    async function walk(directory, relPath = "") {
      const entries = await readdir(directory, { withFileTypes: true });
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
    return { files, folders, pending };
  }

  function remoteTree(folderId) {
    const rows = getRows();
    const folders = {};
    const files = {};
    const pending = [];
    const allFolders = rows.folders || [];
    const allFiles = rows.files || [];

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

  async function uploadAction(pair, action) {
    const path = action.path;
    const item = action.local;
    const size = (await stat(item.path)).size;
    const max = await maxFile();
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
        const currentPath = remoteTree(pair.folder_id).folders[action.path];
        if (currentPath !== action.folder_id || remoteFolderHasContent(currentPath)) continue;
        getRows().removeFolder?.(currentPath);
        continue;
      }

      if (remoteTree(pair.folder_id).folders[action.path]) continue;
      if (await localFolderWillBeEmpty(pair, action.path, new Set(localFileDeletes), localFolderDeletes)) {
        recycle.push(join(pair.local, ...action.path.split("/")));
      }
    }

    if (recycle.length) await removeLocal(recycle);
  }

  async function run(id) {
    const pair = pairs.get(id);
    if (stopped || !pair || pair.paused || running.has(id)) return;
    if (running.size) {
      schedule(pair, 250);
      return;
    }
    running.add(id);
    pair.state = "syncing";
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
      if (!(getRows().folders || []).some((folder) => folder.id === pair.folder_id && !folder.deleted)) {
        throw Object.assign(new Error("The paired Drive folder is missing."), { pause: "drive_folder_missing" });
      }

      const local = await scan(pair.local, pair.base || {});
      let remote = remoteTree(pair.folder_id);
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
      });
      if (plan.massDelete) {
        pair.pending = plan.allActions.length;
        pair.pendingDeletes = { ...plan, actions: plan.allActions };
        pause(pair, "mass_delete");
        return;
      }

      pair.pending = plan.actions.length;
      const localFileDeletes = [];
      for (const action of plan.actions) {
        if (!pairs.has(id)) return;
        if (action.type === "download") {
          await downloadAction(pair, action, local);
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
        pair.pending--;
      }

      if (!pairs.has(id)) return;
      // Make new empty local directories on Drive after file changes are applied.
      for (const folder of Object.keys(local.folders)) {
        if (!folder || pair.base.folders?.[folder] || remote.folders[folder]) continue;
        await ensureFolders(pair, `${folder}/_folder`);
      }
      await syncOnce();
      await processFolderDeletes(pair, plan.actions, localFileDeletes);
      await syncOnce();

      const afterLocal = await scan(pair.local, pair.base || {});
      remote = remoteTree(pair.folder_id);
      const base = { files: {}, folders: { ...remote.folders } };
      for (const [path, localFile] of Object.entries(afterLocal.files)) {
        const remoteFile = remote.files[path];
        if (remoteFile && !remoteFile.sha256) continue;
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
      pair.base = base;
      pair.last_sync = clock();
      pair.state = pair.errors.length ? "error" : "idle";
      pair.reason = null;
      save();
      if (local.pending.length || afterLocal.pending.length) schedule(pair, 2000);
    } catch (error) {
      pair.pending = 0;
      // A file that vanished or was locked mid-pass is retried next pass; only
      // a missing or unreadable root pauses the pair.
      const rootGone = ["ENOENT", "EACCES", "EPERM"].includes(error.code) && !existsSync(pair.local);
      if (error.pause || rootGone) {
        pause(pair, error.pause || "root_unreadable", error.message);
      } else {
        pair.state = "error";
        pair.errors = [{ path: pair.local, error: error.message }];
        emit(pair);
      }
    } finally {
      running.delete(id);
      emit(pair);
      runQueuedResolution();
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
    };
    pairs.set(pair.id, pair);
    save();
    startWatch(pair);
    if (running.size) schedule(pair, 2000);
    else run(pair.id);
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
    return true;
  }

  load();
  for (const pair of pairs.values()) {
    if (!pair.paused) startWatch(pair);
  }

  const interval = setInterval(() => {
    for (const pair of pairs.values()) schedule(pair, 0);
  }, 30000);
  interval.unref?.();

  return {
    list: () => [...pairs.values()].map(view),
    add,
    command,
    remove,
    run,
    schedule: (id, delay = 2000) => {
      const pair = pairs.get(id);
      if (pair) schedule(pair, delay);
    },
    stop: () => {
      stopped = true;
      clearInterval(interval);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers.values()) watcher.close();
    },
  };
}
