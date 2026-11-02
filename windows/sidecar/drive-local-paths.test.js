import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fileBelongsToPair, mapPairFile, mapPairFilePath, mapPairFolder, pairCoversFile, validatePairFolder } from "./drive-local-paths.js";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Drive file ids map to an existing in-pair path only when its bytes match", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-drive-local-path-"));
  try {
    const root = join(temp, "Course");
    const file = join(root, "week 1", "notes.txt");
    await mkdir(join(root, "week 1"), { recursive: true });
    const bytes = Buffer.from("synced notes\n");
    await writeFile(file, bytes);
    const pair = { id: "pair", local: root, paused: false, base: { files: { "week 1/notes.txt": { file_id: "file-1", sha256: sha(bytes), size: bytes.length } } } };

    assert.equal((await mapPairFile(pair, "file-1", { id: "file-1", sha256: sha(bytes), size: bytes.length })).path, resolve(file));
    assert.equal(mapPairFilePath(pair, "file-1").path, resolve(file));
    assert.equal(await mapPairFile(pair, "file-1", { id: "file-1", sha256: "wrong", size: bytes.length }), null);
    assert.equal(mapPairFilePath(pair, "other-file"), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("folder ids map to their local folder and a course pair maps its root", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-drive-folder-path-"));
  try {
    const root = join(temp, "Courses", "Math");
    const sub = join(root, "Week 1");
    await mkdir(sub, { recursive: true });
    const pair = { local: root, folder_id: "course-1", base: { folders: { "Week 1": "folder-1" } } };
    assert.equal(mapPairFolder(pair, "folder-1").path, resolve(sub));
    assert.equal(mapPairFolder(pair, "course-1").path, resolve(root));
    assert.equal(mapPairFolder(pair, "other-folder"), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("pair ownership remains discoverable while a local edit invalidates the synced path cache", () => {
  const pair = { base: { files: { "a.txt": { file_id: "file-1" } } }, syncedFilePaths: new Map() };
  assert.equal(pairCoversFile(pair, "file-1"), true);
  assert.equal(pairCoversFile(pair, "other-file"), false);
});

test("a sync pair owns remote files before its first base is written", () => {
  const pair = { folder_id: "root", mode: "two-way", base: { files: {} } };
  const folders = [{ id: "child", parent_id: "root" }];
  assert.equal(fileBelongsToPair(pair, { id: "file-1", folder_id: "child" }, folders), true);
  assert.equal(fileBelongsToPair(pair, { id: "file-2", folder_id: "elsewhere" }, folders), false);
  assert.equal(fileBelongsToPair({ folder_id: "course-1", mode: "pull", course_id: "course-1" }, { id: "file-3", course_id: "course-1" }), true);
});

test("Explorer reveal validation accepts paths inside a pair and rejects outside paths", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-drive-reveal-path-"));
  try {
    const root = join(temp, "sync");
    const nested = join(root, "nested");
    const outside = join(temp, "outside");
    await Promise.all([mkdir(nested, { recursive: true }), mkdir(outside)]);
    const pair = { local: root };
    assert.equal(validatePairFolder(pair, nested), resolve(nested));
    assert.equal(validatePairFolder(pair, outside), null);
    assert.equal(validatePairFolder(pair, join(root, "missing")), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
