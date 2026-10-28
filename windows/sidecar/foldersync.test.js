import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareTrees, createFolderSync } from "./foldersync.js";

const file = (sha256, extra = {}) => ({ sha256, size: 10, mtime: 1, ...extra });
const fakeWatch = () => Object.assign(new EventEmitter(), { close() {} });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeout = 4000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (check()) return;
    await pause(20);
  }
  assert.ok(check(), "condition did not become true before timeout");
}

async function savedPair({ temp, root, id = "pair-1", folderId = "folder-root", base = {}, paused = false, pendingDeletes }) {
  const data = join(temp, "data");
  await mkdir(data, { recursive: true });
  const pair = {
    id,
    local: root,
    folder_id: folderId,
    paused,
    base,
    ...(pendingDeletes ? { pendingDeletes } : {}),
  };
  await writeFile(join(data, "syncfolders.json"), JSON.stringify([pair]));
  return { data, pair };
}

test("first pairing uploads local-only files, downloads remote-only files, and records identical hashes", () => {
  const plan = compareTrees(
    { files: { "local.txt": file("a"), "same.txt": file("x") } },
    { files: { "remote.txt": file("b", { file_id: "r" }), "same.txt": file("x", { file_id: "s" }) } },
    {},
    { stable: new Set(["local.txt", "same.txt"]) },
  );
  assert.deepEqual(plan.actions.map((action) => action.type).sort(), ["download", "record", "upload"]);
});

test("a remote row without a server hash is deferred instead of becoming a conflict", () => {
  const plan = compareTrees(
    { files: { "report.txt": file("local") } },
    { files: { "report.txt": file("", { file_id: "remote" }) } },
    {},
    { stable: new Set(["report.txt"]), pendingRemote: new Set(["report.txt"]) },
  );
  assert.deepEqual(plan.actions, []);
});

test("an unhashed remote row is left out of the saved base", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-unhashed-"));
  const root = join(temp, "local");
  await mkdir(root);
  await writeFile(join(root, "report.txt"), "local copy");
  const localStat = await stat(join(root, "report.txt"));
  const { data } = await savedPair({
    temp,
    root,
    base: { files: { "report.txt": { file_id: "remote-a", sha256: "prior", mtime: localStat.mtimeMs, size: localStat.size } } },
  });
  const state = {
    folders: [{ id: "folder-root", name: "Drive" }],
    files: [{ id: "remote-a", name: "report.txt", folder_id: "folder-root", sha256: null }],
  };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => assert.fail("unhashed file must not upload"),
    download: async () => assert.fail("unhashed file must not download"),
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    await engine.run("pair-1");
    assert.deepEqual(engine.list()[0].state, "idle");
    assert.deepEqual(JSON.parse(await readFile(join(data, "syncfolders.json"), "utf8"))[0].base.files, {});
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("changed local uploads and changed remote downloads", () => {
  const base = { files: { old: { file_id: "id", sha256: "a" } } };
  const local = compareTrees(
    { files: { old: file("b") } },
    { files: { old: file("a", { file_id: "id" }) } },
    base,
    { stable: new Set(["old"]) },
  );
  const remote = compareTrees(
    { files: { old: file("a") } },
    { files: { old: file("b", { file_id: "id" }) } },
    base,
    { stable: new Set(["old"]) },
  );
  assert.equal(local.actions[0].type, "upload");
  assert.equal(remote.actions[0].type, "download");
});

test("simultaneous and first-pair differing files get a timestamped conflict name", () => {
  const now = new Date(2026, 9, 28, 9, 4);
  const firstPair = compareTrees(
    { files: { "report.txt": file("local") } },
    { files: { "report.txt": file("remote", { file_id: "r" }) } },
    {},
    { device: "Maro-PC", now, stable: new Set(["report.txt"]) },
  );
  const simultaneous = compareTrees(
    { files: { "report.txt": file("local") } },
    { files: { "report.txt": file("remote", { file_id: "r" }) } },
    { files: { "report.txt": { file_id: "r", sha256: "base" } } },
    { device: "Maro-PC", now, stable: new Set(["report.txt"]) },
  );
  for (const plan of [firstPair, simultaneous]) {
    assert.equal(plan.actions[0].type, "conflict");
    assert.equal(plan.actions[0].conflict, "report (conflict, Maro-PC 2026-10-28 09.04).txt");
  }
});

test("remote rename follows file id and local move follows the base hash", () => {
  const base = { files: { "old/a.txt": { file_id: "id", sha256: "a" } } };
  const remoteMove = compareTrees(
    { files: { "old/a.txt": file("a") } },
    { files: { "new/a.txt": file("a", { file_id: "id" }) } },
    base,
    { stable: new Set(["old/a.txt"]) },
  );
  const localMove = compareTrees(
    { files: { "new/a.txt": file("a") } },
    { files: { "old/a.txt": file("a", { file_id: "id" }) } },
    base,
    { stable: new Set(["new/a.txt"]) },
  );
  assert.deepEqual(remoteMove.actions.map((action) => action.type), ["remote_move"]);
  assert.deepEqual(localMove.actions.map((action) => action.type), ["local_move"]);
});

test("folder deletion candidates are suppressed when the other side has changed or new files", () => {
  const base = {
    files: { "class/a.txt": { file_id: "a", sha256: "base" } },
    folders: { class: "folder-class" },
  };
  const unchanged = compareTrees(
    { files: {}, folders: {} },
    { files: { "class/a.txt": file("base", { file_id: "a" }) }, folders: { class: "folder-class" } },
    base,
  );
  const changed = compareTrees(
    { files: {}, folders: {} },
    { files: { "class/a.txt": file("new", { file_id: "a" }) }, folders: { class: "folder-class" } },
    base,
  );
  const added = compareTrees(
    { files: {}, folders: {} },
    { files: { "class/new.txt": file("new", { file_id: "new" }) }, folders: { class: "folder-class" } },
    base,
  );
  const localChanged = compareTrees(
    { files: { "class/a.txt": file("local edit") }, folders: { class: null } },
    { files: {}, folders: {} },
    base,
    { stable: new Set(["class/a.txt"]) },
  );
  assert(unchanged.actions.some((action) => action.type === "delete_remote_folder"));
  assert(!changed.actions.some((action) => action.type.endsWith("_folder")));
  assert(!added.actions.some((action) => action.type.endsWith("_folder")));
  assert(!localChanged.actions.some((action) => action.type.endsWith("_folder")));
});

test("one delete from three files is allowed, while five deletes above 25 percent pause", () => {
  const three = { files: {}, folders: {} };
  for (const name of ["a", "b", "c"]) {
    three.files[name] = { file_id: name, sha256: name };
  }
  const one = compareTrees(
    { files: { a: file("a"), b: file("b") } },
    { files: { a: file("a", { file_id: "a" }), b: file("b", { file_id: "b" }), c: file("c", { file_id: "c" }) } },
    three,
  );

  const base = { files: {}, folders: {} };
  const local = { files: {}, folders: {} };
  const remote = { files: {}, folders: {} };
  for (let i = 0; i < 16; i++) {
    const path = `f${i}.txt`;
    base.files[path] = { file_id: path, sha256: path };
    remote.files[path] = file(path, { file_id: path });
    if (i >= 5) local.files[path] = file(path);
  }
  const five = compareTrees(local, remote, base);
  const overTwentyBase = { files: {}, folders: {} };
  const overTwentyLocal = { files: {}, folders: {} };
  const overTwentyRemote = { files: {}, folders: {} };
  for (let i = 0; i < 100; i++) {
    const path = `large-${i}.txt`;
    overTwentyBase.files[path] = { file_id: path, sha256: path };
    overTwentyRemote.files[path] = file(path, { file_id: path });
    if (i >= 21) overTwentyLocal.files[path] = file(path);
  }
  const overTwenty = compareTrees(overTwentyLocal, overTwentyRemote, overTwentyBase);
  assert.equal(one.massDelete, false);
  assert.equal(five.massDelete, true);
  assert.equal(overTwenty.massDelete, true);
  assert(!five.actions.some((action) => action.type.startsWith("delete_")));
});

test("folder deletes contribute to the mass-delete threshold", () => {
  const base = { files: {}, folders: {} };
  const local = { files: {}, folders: {} };
  const remote = { files: {}, folders: {} };
  for (let i = 0; i < 16; i++) {
    const path = `folder${i}`;
    base.folders[path] = `id-${i}`;
    remote.folders[path] = `id-${i}`;
    if (i >= 5) local.folders[path] = null;
  }
  const plan = compareTrees(local, remote, base);
  assert.equal(plan.deleteRemote, 5);
  assert.equal(plan.massDelete, true);
});

test("unstable local writes and unhashed remote files are held for a later pass", () => {
  const plan = compareTrees(
    { files: {}, pending: ["same.txt"] },
    { files: { "same.txt": file("", { file_id: "r" }) }, pending: ["same.txt"] },
    {},
    { pending: new Set(["same.txt"]), pendingRemote: new Set(["same.txt"]) },
  );
  assert.deepEqual(plan.actions, []);
});

test("a real filesystem write triggers the recursive watcher within three seconds", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-watch-"));
  const root = join(temp, "local");
  await mkdir(root);
  const folderId = "folder-root";
  let sawSyncAfterWrite = false;
  let wrote = false;
  const engine = createFolderSync({
    dataDir: join(temp, "data"),
    driveDir: join(temp, "drive"),
    getRows: () => ({ folders: [{ id: folderId, name: "Drive" }], files: [] }),
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async () => {},
    signedIn: () => false,
    onState: (state) => {
      if (wrote && state.state === "syncing") sawSyncAfterWrite = true;
    },
  });

  try {
    const pair = engine.add(root, folderId);
    await waitFor(() => engine.list()[0].state === "idle");
    wrote = true;
    await writeFile(join(root, "watched.txt"), "watch me");
    await waitFor(() => sawSyncAfterWrite, 3000);
    assert.equal(sawSyncAfterWrite, true);
    engine.remove(pair.id);
  } finally {
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("row-change schedules are debounced into one pass", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-debounce-"));
  const root = join(temp, "local");
  await mkdir(root);
  let passStarts = 0;
  const engine = createFolderSync({
    dataDir: join(temp, "data"),
    driveDir: join(temp, "drive"),
    getRows: () => ({ folders: [{ id: "folder-root", name: "Drive" }], files: [] }),
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
    onState: (state) => {
      if (state.state === "syncing") passStarts++;
    },
  });

  try {
    const pair = engine.add(root, "folder-root");
    await waitFor(() => engine.list()[0].state === "idle");
    const initialPasses = passStarts;
    engine.schedule(pair.id, 50);
    engine.schedule(pair.id, 50);
    engine.schedule(pair.id, 50);
    await pause(100);
    assert.equal(passStarts - initialPasses, 1);
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("adding a pair while another pass runs waits for the active pass", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-add-running-"));
  const firstRoot = join(temp, "first");
  const secondRoot = join(temp, "second");
  await mkdir(firstRoot);
  await mkdir(secondRoot);
  let activePasses = 0;
  let maxActivePasses = 0;
  const activeIds = new Set();
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const engine = createFolderSync({
    dataDir: join(temp, "data"),
    driveDir: join(temp, "drive"),
    getRows: () => ({ folders: [{ id: "folder-root", name: "Drive" }], files: [] }),
    syncOnce: async () => {
      activePasses++;
      maxActivePasses = Math.max(maxActivePasses, activePasses);
      if (activePasses === 1 && maxActivePasses === 1 && activeIds.size === 1 && !releaseFirst.used) {
        releaseFirst.used = true;
        firstStarted();
        await gate;
      }
      activePasses--;
    },
    upload: async () => {},
    download: async () => {},
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
    onState: (state) => {
      if (state.state === "syncing") activeIds.add(state.id);
      else activeIds.delete(state.id);
      maxActivePasses = Math.max(maxActivePasses, activeIds.size);
    },
  });

  try {
    const first = engine.add(firstRoot, "folder-root");
    await started;
    const second = engine.add(secondRoot, "folder-root");
    releaseFirst();
    await waitFor(() => engine.list().filter((pair) => pair.last_sync).length === 2, 3500);
    assert.equal(maxActivePasses, 1);
    engine.remove(first.id);
    engine.remove(second.id);
  } finally {
    releaseFirst?.();
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a deleted remote folder recycles its unchanged files and folder in one batch", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-delete-"));
  const root = join(temp, "local");
  const sub = join(root, "class");
  await mkdir(sub, { recursive: true });
  await writeFile(join(sub, "a.txt"), "same");
  const fileStat = await stat(join(sub, "a.txt"));
  const { data } = await savedPair({
    temp,
    root,
    base: {
      files: { "class/a.txt": { file_id: "file-a", sha256: "hash-a", mtime: fileStat.mtimeMs, size: fileStat.size } },
      folders: { class: "folder-class" },
    },
  });
  let recycled;
  const state = {
    folders: [{ id: "folder-root", name: "Drive" }],
    files: [],
  };
  state.removeFile = (id) => { state.files = state.files.filter((row) => row.id !== id); };
  state.removeFolder = () => {};
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async (paths) => {
      recycled = paths;
      for (const path of paths) await rm(path, { recursive: true, force: true });
    },
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    await engine.run("pair-1");
    assert.deepEqual(recycled.sort(), [join(root, "class", "a.txt"), sub].sort());
    assert.deepEqual(await readdir(root), []);
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("deleting a local folder tombstones its now-empty Drive folder", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-drive-delete-"));
  const root = join(temp, "local");
  await mkdir(root);
  const { data } = await savedPair({
    temp,
    root,
    base: {
      files: { "class/a.txt": { file_id: "file-a", sha256: "same" } },
      folders: { class: "folder-class" },
    },
  });
  const state = {
    folders: [
      { id: "folder-root", name: "Drive" },
      { id: "folder-class", name: "class", parent_id: "folder-root" },
    ],
    files: [
      { id: "file-a", name: "a.txt", folder_id: "folder-class", sha256: "same" },
    ],
    removeFile(id) {
      state.files = state.files.filter((row) => row.id !== id);
    },
    removeFolder(id) {
      state.folders = state.folders.filter((row) => row.id !== id);
    },
  };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    await engine.run("pair-1");
    assert.deepEqual(state.files, []);
    assert.deepEqual(state.folders.map((folder) => folder.id), ["folder-root"]);
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("multiple deleted local files are passed to the Recycle Bin adapter once", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-batch-"));
  const root = join(temp, "local");
  await mkdir(root);
  await writeFile(join(root, "a.txt"), "a");
  await writeFile(join(root, "b.txt"), "b");
  const a = await stat(join(root, "a.txt"));
  const b = await stat(join(root, "b.txt"));
  const { data } = await savedPair({
    temp,
    root,
    base: { files: {
      "a.txt": { file_id: "a", sha256: "a", mtime: a.mtimeMs, size: a.size },
      "b.txt": { file_id: "b", sha256: "b", mtime: b.mtimeMs, size: b.size },
    } },
  });
  let calls = 0;
  let paths = [];
  const state = { folders: [{ id: "folder-root", name: "Drive" }], files: [] };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async (batch) => {
      calls++;
      paths = batch;
    },
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    await engine.run("pair-1");
    assert.equal(calls, 1);
    assert.deepEqual(paths.sort(), [join(root, "a.txt"), join(root, "b.txt")].sort());
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a conflict uploads the local copy and restores the remote copy in the same pass", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-conflict-"));
  const root = join(temp, "local");
  await mkdir(root);
  const original = join(root, "report.txt");
  await writeFile(original, "local edit");
  const { data } = await savedPair({
    temp,
    root,
    base: { files: { "report.txt": { file_id: "remote-a", sha256: "base", mtime: 0, size: 0 } } },
  });
  const remoteBytes = "remote edit";
  const state = {
    folders: [{ id: "folder-root", name: "Drive" }],
    files: [{ id: "remote-a", name: "report.txt", folder_id: "folder-root", sha256: "remote-hash" }],
  };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async (path, options) => {
      state.files.push({ id: "conflict-a", name: options.name, folder_id: options.folder_id, sha256: "local-hash" });
    },
    download: async (_id, part) => writeFile(part, remoteBytes),
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    await engine.run("pair-1");
    await waitFor(() => state.files.some((row) => row.id === "conflict-a") && existsSync(original));
    assert.equal(await readFile(original, "utf8"), remoteBytes);
    const names = await readdir(root);
    const conflict = names.find((name) => name.includes("(conflict,"));
    assert.ok(conflict);
    assert.equal(await readFile(join(root, conflict), "utf8"), "local edit");
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a target edited during download is preserved beside a conflict copy", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-download-race-"));
  const root = join(temp, "local");
  await mkdir(root);
  const target = join(root, "notes.txt");
  await writeFile(target, "base");
  const current = await stat(target);
  const { data } = await savedPair({
    temp,
    root,
    base: { files: { "notes.txt": { file_id: "remote-a", sha256: "base", mtime: current.mtimeMs, size: current.size } } },
  });
  const state = {
    folders: [{ id: "folder-root", name: "Drive" }],
    files: [{ id: "remote-a", name: "notes.txt", folder_id: "folder-root", sha256: "remote" }],
  };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => {},
    download: async (_id, part) => {
      await writeFile(target, "new local edit with a different size");
      await writeFile(part, "remote version");
    },
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    await engine.run("pair-1");
    assert.equal(await readFile(target, "utf8"), "new local edit with a different size");
    const conflict = (await readdir(root)).find((name) => name.includes("(conflict,"));
    assert.ok(conflict);
    assert.equal(await readFile(join(root, conflict), "utf8"), "remote version");
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a missing sync root pauses the pair instead of planning deletions", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-root-"));
  const data = join(temp, "data");
  const root = join(temp, "local");
  await mkdir(data);
  await mkdir(root);
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => ({ folders: [], files: [] }),
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async () => {},
    signedIn: () => false,
    watchFactory: fakeWatch,
  });

  let pairId;
  try {
    const pair = engine.add(root, "folder");
    pairId = pair.id;
    await waitFor(() => engine.list()[0].state === "idle");
    await rm(root, { recursive: true });
    await engine.run(pair.id);
    assert.equal(engine.list()[0].state, "paused");
    assert.equal(engine.list()[0].reason, "root_unreadable");
  } finally {
    if (pairId) engine.remove(pairId);
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("a saved mass-delete decision survives restart and keep restores the missing file", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-restart-"));
  const root = join(temp, "local");
  await mkdir(root);
  const { data } = await savedPair({
    temp,
    root,
    paused: true,
    pendingDeletes: {
      actions: [{
        type: "delete_remote",
        path: "restored.txt",
        file_id: "remote-a",
        remote: { file_id: "remote-a", sha256: "hash" },
      }],
    },
  });
  let downloads = 0;
  const state = { folders: [{ id: "folder-root", name: "Drive" }], files: [] };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => {},
    download: async (_id, part) => {
      downloads++;
      await writeFile(part, "restored");
    },
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    engine.command("pair-1", "keep");
    await waitFor(() => downloads === 1 && exists(join(root, "restored.txt")));
    assert.equal(await readFile(join(root, "restored.txt"), "utf8"), "restored");
    assert.equal(JSON.parse(await readFile(join(data, "syncfolders.json"), "utf8"))[0].pendingDeletes, undefined);
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("confirm applies the saved deletion decisions", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-confirm-"));
  const root = join(temp, "local");
  await mkdir(root);
  const { data } = await savedPair({
    temp,
    root,
    paused: true,
    pendingDeletes: {
      actions: [{ type: "delete_remote", path: "gone.txt", file_id: "file-a", remote: {} }],
    },
  });
  let removed = 0;
  const state = {
    folders: [{ id: "folder-root", name: "Drive" }],
    files: [],
    removeFile: () => { removed++; },
  };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {},
    upload: async () => {},
    download: async () => {},
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    engine.command("pair-1", "confirm");
    await waitFor(() => JSON.parse(requireText(join(data, "syncfolders.json")))[0].pendingDeletes === undefined);
    assert.equal(removed, 1);
  } finally {
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

test("keep waits for a running pass before applying its saved decision", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-folder-queued-keep-"));
  const root = join(temp, "local");
  await mkdir(root);
  const { data } = await savedPair({
    temp,
    root,
    pendingDeletes: {
      actions: [{
        type: "delete_remote",
        path: "restored.txt",
        file_id: "remote-a",
        remote: { file_id: "remote-a", sha256: "hash" },
      }],
    },
  });
  let releasePass;
  let passStarted;
  const started = new Promise((resolve) => { passStarted = resolve; });
  const gate = new Promise((resolve) => { releasePass = resolve; });
  let syncCalls = 0;
  let downloads = 0;
  const state = { folders: [{ id: "folder-root", name: "Drive" }], files: [] };
  const engine = createFolderSync({
    dataDir: data,
    driveDir: join(temp, "drive"),
    getRows: () => state,
    syncOnce: async () => {
      if (syncCalls++ === 0) {
        passStarted();
        await gate;
      }
    },
    upload: async () => {},
    download: async (_id, part) => {
      downloads++;
      await writeFile(part, "restored");
    },
    removeLocal: async () => {},
    signedIn: () => true,
    watchFactory: fakeWatch,
  });

  try {
    const run = engine.run("pair-1");
    await started;
    engine.command("pair-1", "keep");
    assert.equal(downloads, 0);
    releasePass();
    await run;
    await waitFor(() => downloads === 1 && existsSync(join(root, "restored.txt")));
    assert.equal(await readFile(join(root, "restored.txt"), "utf8"), "restored");
  } finally {
    releasePass?.();
    engine.remove("pair-1");
    engine.stop();
    await rm(temp, { recursive: true, force: true });
  }
});

function exists(path) {
  return existsSync(path);
}

function requireText(path) {
  return readFileSync(path, "utf8");
}
