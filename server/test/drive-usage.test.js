import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureDriveTree, parseRcloneAbout, sumFileSizes } from "../drive-usage.js";

test("drive tree scan returns total and per-user bytes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hg-drive-usage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const ownerDrive = join(root, "owner", "drive");
  const ownerVersions = join(ownerDrive, "versions", "file-a");
  const otherDrive = join(root, "other-user", "drive");
  mkdirSync(ownerDrive, { recursive: true });
  mkdirSync(ownerVersions, { recursive: true });
  mkdirSync(otherDrive, { recursive: true });
  writeFileSync(join(ownerDrive, "file-a"), Buffer.alloc(7));
  writeFileSync(join(ownerVersions, "old-version"), Buffer.alloc(5));
  writeFileSync(join(otherDrive, "file-b"), Buffer.alloc(11));

  const measured = await measureDriveTree(root);
  assert.equal(measured.used, 23);
  assert.equal(measured.driveBytes.get("owner"), 12);
  assert.equal(measured.driveBytes.get("other-user"), 11);
});

test("file size fallback adds string sizes numerically", () => {
  assert.equal(sumFileSizes([{ size: "12" }, { size: "34" }]), 46);
});

test("rclone about parser converts quota units and includes trash in used", () => {
  const parsed = parseRcloneAbout("Total: 5.002 TiB\nUsed: 37.980 GiB\nFree: 4.961 TiB\nTrashed: 2.258 GiB\nOther: 3.942 GiB\n");
  assert.deepEqual(parsed, {
    total: Math.round(5.002 * 1024 ** 4),
    used: Math.round(37.980 * 1024 ** 3) + Math.round(2.258 * 1024 ** 3),
    free: Math.round(4.961 * 1024 ** 4),
    trashed: Math.round(2.258 * 1024 ** 3),
    other: Math.round(3.942 * 1024 ** 3),
  });
});

test("rclone about parser accepts MiB and missing optional lines", () => {
  assert.deepEqual(parseRcloneAbout("Total: 3 MiB\nUsed: 1 MiB\nFree: 2 MiB\n"), {
    total: 3 * 1024 ** 2,
    used: 1024 ** 2,
    free: 2 * 1024 ** 2,
    trashed: 0,
    other: 0,
  });
  assert.equal(parseRcloneAbout("Total: 3 MiB\nUsed: 1 MiB\n"), null);
});

test("empty drive tree has zero used and mine bytes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hg-drive-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const measured = await measureDriveTree(root);
  assert.equal(measured.used, 0);
  assert.equal(measured.driveBytes.get("owner") || 0, 0);
});
