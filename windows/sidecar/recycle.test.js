import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveFilesToRecycleBin, recycleScript } from "./recycle.js";

const skip = process.platform !== "win32";

test("the script ends with a blank line, or PowerShell drops its last block", () => {
  assert.match(recycleScript(["C:\\x.txt"]), /}\r?\n\r?\n$/);
});

// It really sends them (that was the bug: exit code 0 and nothing deleted).
test("files, Arabic names included, then their emptied folder go to the Recycle Bin", { skip }, async () => {
  const root = await mkdtemp(join(tmpdir(), "hg-recycle-"));
  try {
    const sub = join(root, "Arabic");
    await mkdir(sub);
    const files = [join(root, "Exams.txt"), join(sub, "الامتحانات.txt"), join(root, "الاسبوع السابع.txt")];
    for (const f of files) await writeFile(f, "x");
    await moveFilesToRecycleBin([...files, sub]);
    for (const f of files) assert.equal(existsSync(f), false, f);
    assert.equal(existsSync(sub), false, "the emptied folder");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a folder that still holds something is not sent, and says so", { skip }, async () => {
  const root = await mkdtemp(join(tmpdir(), "hg-recycle-"));
  try {
    await writeFile(join(root, "keep.txt"), "x");
    await assert.rejects(moveFilesToRecycleBin([root]), /Folder is not empty/);
    assert.equal(existsSync(join(root, "keep.txt")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
