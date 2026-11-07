import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isJunk, readTree, uploadTree } from "./upload-tree.js";

// The folder that crashed the sidecar: week files, and an English and an Arabic folder.
async function lectures() {
  const root = await mkdtemp(join(tmpdir(), "hg-upload-tree-"));
  const dir = join(root, "lectures");
  await mkdir(join(dir, "English"), { recursive: true });
  await mkdir(join(dir, "Arabic"), { recursive: true });
  await writeFile(join(dir, "الاسبوع السابع.docx"), "7");
  await writeFile(join(dir, "الاسبوع الثاني.docx"), "2");
  await writeFile(join(dir, "desktop.ini"), "junk");
  await writeFile(join(dir, "~$الاسبوع السابع.docx"), "office lock");
  await writeFile(join(dir, "English", "Porcelain Formation - Exams.pdf"), "pdf");
  await writeFile(join(dir, "English", "Thumbs.db"), "junk");
  await writeFile(join(dir, "Arabic", "تشكيل البورسلين - الامتحانات.pdf"), "pdf");
  return { root, dir };
}

// A fake Drive: folders and files as the sidecar would make them.
function drive({ failUpload = () => false, failFolder = () => false } = {}) {
  const folders = [], files = [];
  let n = 0;
  return {
    folders, files,
    addFolder: async (name, parent_id) => {
      if (failFolder(name)) throw new Error(`${name}: the folder could not reach the server`);
      const row = { id: `f${++n}`, name, parent_id };
      folders.push(row);
      return row;
    },
    upload: async (f, folder) => {
      if (failUpload(f.name)) throw new Error(`Could not read ${f.name} (EBUSY).`);
      const row = { id: `x${++n}`, name: f.name, folder_id: folder };
      files.push(row);
      return row;
    },
  };
}

test("junk names are left out", () => {
  for (const n of ["desktop.ini", "Thumbs.db", "THUMBS.DB", ".DS_Store", "~$week.docx", ".hidden"]) assert.ok(isJunk(n), n);
  for (const n of ["الاسبوع السابع.docx", "Exams.pdf", "notes~.txt"]) assert.ok(!isJunk(n), n);
});

test("a dropped folder reads as a tree, Arabic names and all, without junk", async () => {
  const { root, dir } = await lectures();
  try {
    const tree = readTree(dir);
    assert.equal(tree.name, "lectures");
    assert.deepEqual(tree.files.map((f) => f.name).sort(), ["الاسبوع الثاني.docx", "الاسبوع السابع.docx"].sort());
    assert.deepEqual(tree.folders.map((f) => f.name).sort(), ["Arabic", "English"]);
    const english = tree.folders.find((f) => f.name === "English");
    assert.deepEqual(english.files.map((f) => f.name), ["Porcelain Formation - Exams.pdf"]);
    assert.equal(english.files[0].path, join(dir, "English", "Porcelain Formation - Exams.pdf"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("into a Drive folder the folders come along", async () => {
  const { root, dir } = await lectures();
  try {
    const d = drive();
    const out = await uploadTree(readTree(dir), { parent: "drive-parent", ...d });
    assert.equal(out.folder.name, "lectures");
    assert.equal(out.folder.parent_id, "drive-parent");
    const byName = Object.fromEntries(d.folders.map((f) => [f.name, f]));
    assert.equal(byName.English.parent_id, out.folder.id);
    assert.equal(byName.Arabic.parent_id, out.folder.id);
    const where = Object.fromEntries(d.files.map((f) => [f.name, f.folder_id]));
    assert.equal(where["الاسبوع السابع.docx"], out.folder.id);
    assert.equal(where["Porcelain Formation - Exams.pdf"], byName.English.id);
    assert.equal(where["تشكيل البورسلين - الامتحانات.pdf"], byName.Arabic.id);
    assert.equal(out.files.length, 4);
    assert.deepEqual(out.failed, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("into a course or a note every file goes in flat", async () => {
  const { root, dir } = await lectures();
  try {
    const d = drive();
    const out = await uploadTree(readTree(dir), { flat: true, parent: null, ...d });
    assert.equal(out.folder, null);
    assert.equal(d.folders.length, 0);
    assert.equal(d.files.length, 4);
    assert.ok(d.files.every((f) => f.folder_id === null));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a file or folder that fails doesn't stop the rest", async () => {
  const { root, dir } = await lectures();
  try {
    const d = drive({ failUpload: (n) => n === "الاسبوع الثاني.docx", failFolder: (n) => n === "Arabic" });
    const out = await uploadTree(readTree(dir), { ...d });
    assert.deepEqual(out.files.map((f) => f.name).sort(), ["Porcelain Formation - Exams.pdf", "الاسبوع السابع.docx"].sort());
    assert.deepEqual(out.failed.map((f) => f.name).sort(), ["Arabic", "الاسبوع الثاني.docx"].sort());
    assert.match(out.failed.find((f) => f.name === "Arabic").error, /could not reach the server/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
