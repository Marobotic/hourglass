import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legacyCoursesDirectory, migrateLegacyCoursePairs, moveCourseDirectory, resolveCoursesDirectory } from "./courses-paths.js";
import { createFolderSync } from "./foldersync.js";

test("Windows Documents resolution expands the User Shell Folders registry value", async () => {
  const resolved = await resolveCoursesDirectory({
    platform: "win32",
    home: "C:\\Users\\Maro",
    env: { USERPROFILE: "C:\\Users\\Maro" },
    readRegistry: async () => "%USERPROFILE%\\OneDrive - Maro\\Documents",
  });
  assert.equal(resolved, "C:\\Users\\Maro\\OneDrive - Maro\\Documents\\Courses");
});

test("Documents resolution falls back to the profile Documents folder and honors the test override", async () => {
  const fallback = await resolveCoursesDirectory({
    platform: "win32",
    home: "C:\\Users\\Maro",
    env: { USERPROFILE: "C:\\Users\\Maro" },
    readRegistry: async () => { throw new Error("registry unavailable"); },
  });
  assert.equal(fallback, "C:\\Users\\Maro\\Documents\\Courses");

  const override = await resolveCoursesDirectory({
    platform: "win32",
    home: "C:\\Users\\Maro",
    env: { HOURGLASS_COURSES_DIR: "D:\\test-profile\\Courses" },
    readRegistry: async () => { throw new Error("must not query registry"); },
  });
  assert.equal(override, "D:\\test-profile\\Courses");
});

test("Linux Documents resolution follows XDG_DOCUMENTS_DIR", async () => {
  const resolved = await resolveCoursesDirectory({
    platform: "linux",
    home: "/home/test user",
    env: { HOME: "/home/test user" },
    readUserDirs: async () => 'XDG_DOCUMENTS_DIR="$HOME/OneDrive/Documents"\n',
  });
  assert.equal(resolved, "/home/test user/OneDrive/Documents/Courses");
});

test("legacy course root follows the temporary user profile in tests", () => {
  assert.equal(
    legacyCoursesDirectory({ platform: "win32", home: "C:\\unused", env: { USERPROFILE: "C:\\test-profile" } }),
    "C:\\test-profile\\Hourglass\\Courses",
  );
});

test("legacy pull courses move and persist their path and sync base; two-way folders stay put", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-courses-migrate-"));
  const profile = join(temp, "profile");
  const oldRoot = legacyCoursesDirectory({ platform: process.platform, home: profile, env: { USERPROFILE: profile } });
  const newRoot = join(temp, "Documents", "Courses");
  const oldCourse = join(oldRoot, "Physics");
  const twoWay = join(oldRoot, "Chosen by user");
  const courseId = randomUUID();
  const twoWayId = randomUUID();
  const base = { files: { "lecture.pdf": { file_id: "remote-file", sha256: "abc", size: 3 } }, folders: {} };
  const dataDir = join(temp, "data");
  const storedPairs = [
    { id: courseId, local: oldCourse, folder_id: "course-folder", course_id: "course-id", mode: "pull", paused: true, base, last_sync: "2026-10-31T10:00:00Z" },
    { id: twoWayId, local: twoWay, folder_id: "user-folder", mode: "two-way", paused: true, base: { files: {}, folders: {} } },
  ];
  let engine;

  try {
    await mkdir(oldCourse, { recursive: true });
    await mkdir(twoWay, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(oldCourse, "lecture.pdf"), "abc");
    await writeFile(join(dataDir, "syncfolders.json"), JSON.stringify(storedPairs));
    engine = createFolderSync({
      dataDir,
      driveDir: join(temp, "drive"),
      getRows: () => ({ folders: [], files: [] }),
      syncOnce: async () => {},
      upload: async () => {},
      download: async () => {},
      removeLocal: async () => {},
      signedIn: () => false,
      deferStart: true,
    });

    const moved = await migrateLegacyCoursePairs({
      pairs: engine.list(),
      oldRoot,
      newRoot,
      updatePair: (id, local) => engine.relocatePull(id, local),
      log: () => {},
    });
    assert.equal(moved, 1);
    assert.equal(await readFile(join(newRoot, "Physics", "lecture.pdf"), "utf8"), "abc");
    await assert.rejects(readFile(join(oldCourse, "lecture.pdf")));
    assert.equal(engine.list().find((pair) => pair.id === courseId).local, join(newRoot, "Physics"));
    assert.equal(engine.list().find((pair) => pair.id === twoWayId).local, twoWay);
    assert.equal(engine.list().find((pair) => pair.id === courseId).paused, true);

    const persisted = JSON.parse(await readFile(join(dataDir, "syncfolders.json"), "utf8"));
    const migratedPair = persisted.find((pair) => pair.id === courseId);
    assert.equal(migratedPair.local, join(newRoot, "Physics"));
    assert.deepEqual(migratedPair.base, base);
    assert.equal(migratedPair.last_sync, "2026-10-31T10:00:00Z");
    assert.equal(migratedPair.paused, true);
    assert.equal(persisted.find((pair) => pair.id === twoWayId).local, twoWay);
    assert.deepEqual(await readdir(oldRoot), ["Chosen by user"]);
  } finally {
    engine?.stop();
    await rm(temp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("migration skips an existing destination and leaves both folders untouched", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-courses-conflict-"));
  const oldRoot = join(temp, "profile", "Hourglass", "Courses");
  const newRoot = join(temp, "Documents", "Courses");
  const source = join(oldRoot, "Chemistry");
  const target = join(newRoot, "Chemistry");
  const pair = { id: "pull-1", local: source, mode: "pull" };
  const updates = [];
  try {
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "old.txt"), "keep source");
    await writeFile(join(target, "new.txt"), "keep destination");
    const moved = await migrateLegacyCoursePairs({
      pairs: [pair], oldRoot, newRoot,
      updatePair: async (...args) => updates.push(args),
      log: () => {},
    });
    assert.equal(moved, 0);
    assert.deepEqual(updates, []);
    assert.equal(await readFile(join(source, "old.txt"), "utf8"), "keep source");
    assert.equal(await readFile(join(target, "new.txt"), "utf8"), "keep destination");
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("the legacy courses root is removed only after its migrated contents leave it empty", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-courses-empty-"));
  const oldRoot = join(temp, "profile", "Hourglass", "Courses");
  const newRoot = join(temp, "Documents", "Courses");
  const source = join(oldRoot, "History");
  try {
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "notes.txt"), "history notes");
    const moved = await migrateLegacyCoursePairs({
      pairs: [{ id: "pull-history", local: source, mode: "pull" }],
      oldRoot,
      newRoot,
      updatePair: async () => true,
      log: () => {},
    });
    assert.equal(moved, 1);
    assert.equal(await readFile(join(newRoot, "History", "notes.txt"), "utf8"), "history notes");
    await assert.rejects(readdir(oldRoot), { code: "ENOENT" });
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("cross-volume course move copies first and removes the source after success", async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-courses-cross-volume-"));
  const source = join(temp, "source");
  const target = join(temp, "target", "course");
  try {
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "note.txt"), "course note");
    await moveCourseDirectory(source, target, {
      renameDirectory: async () => { const error = new Error("different device"); error.code = "EXDEV"; throw error; },
    });
    assert.equal(await readFile(join(target, "note.txt"), "utf8"), "course note");
    await assert.rejects(readFile(join(source, "note.txt")));
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5 });
  }
});
