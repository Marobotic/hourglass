// Drive file versions (server/versions.js): what is kept when a file's
// contents are replaced, restoring, the 20-version limit, and the line diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVersions, lineDiff, KEEP } from "../versions.js";

const root = mkdtempSync(join(tmpdir(), "hg-versions-"));
const t = { dir: join(root, "acct"), email: "a@b.c" };
const drivePath = (t, id) => join(t.dir, "drive", id);
mkdirSync(join(t.dir, "drive"), { recursive: true });
const versions = createVersions({ drivePath });
const put = (row, text, device) => {
  const tmp = drivePath(t, row.id) + ".put";
  writeFileSync(tmp, text);
  versions.replace(t, row, tmp, { by: t.email, device }, { size: text.length });
  row.size = text.length;
};

test("a replaced file keeps its old contents, with who replaced them", () => {
  const row = { id: "11111111-1111-1111-1111-111111111111", name: "a.txt", mime: "text/plain", size: 3 };
  put(row, "one", "PC"); // the first contents (no file before: nothing kept)
  put(row, "two", "Phone");
  put(row, "three", "PC");
  const list = versions.list(t, row);
  assert.equal(list.current.device, "PC");
  assert.deepEqual(list.versions.map((v) => readFileSync(versions.path(t, row.id, v.id), "utf8")), ["two", "one"]);
  assert.deepEqual(list.versions.map((v) => v.device), ["Phone", "PC"]);
  assert.equal(versions.bytes(t, [row.id]), 6);
});

test("restoring keeps what was there as a version too", async () => {
  const row = { id: "22222222-2222-2222-2222-222222222222", name: "b.txt", mime: "text/plain", size: 0 };
  put(row, "first", "PC");
  put(row, "second", "PC");
  const old = versions.list(t, row).versions[0];
  const tmp = await versions.copyOut(t, row.id, old.id);
  versions.replace(t, row, tmp, { by: t.email, device: "Phone" }, { size: 5, restored_from: old.id });
  assert.equal(readFileSync(drivePath(t, row.id), "utf8"), "first");
  const list = versions.list(t, row);
  assert.equal(list.current.restored_from, old.id);
  assert.deepEqual(list.versions.map((v) => readFileSync(versions.path(t, row.id, v.id), "utf8")), ["second", "first"]);
});

test(`only the last ${KEEP} versions are kept`, () => {
  const row = { id: "33333333-3333-3333-3333-333333333333", name: "c.txt", mime: "text/plain", size: 0 };
  for (let i = 0; i < KEEP + 5; i++) put(row, `v${i}`, "PC");
  const list = versions.list(t, row);
  assert.equal(list.versions.length, KEEP);
  assert.equal(readFileSync(versions.path(t, row.id, list.versions[0].id), "utf8"), `v${KEEP + 3}`);
});

test("removing a file removes its versions", async () => {
  const row = { id: "22222222-2222-2222-2222-222222222222" };
  const kept = versions.list(t, { ...row, name: "b.txt" }).versions[0];
  await versions.remove(t, row.id);
  assert.equal(existsSync(versions.path(t, row.id, kept.id)), false);
  assert.equal(versions.list(t, { ...row, name: "b.txt" }).versions.length, 0);
});

test("line diff: what was taken out, what was put in, the rest folded", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
  const after = ["a", "b", "c", "d", "E", "f", "g", "h", "i", "j", "k"].join("\n");
  const d = lineDiff(before, after, { context: 1 });
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.deepEqual(d.lines.map((l) => l.op === "skip" ? `~${l.count}` : `${l.op[0]}${l.text}`), ["~3", "sd", "de", "aE", "sf", "~3", "sj", "ak"]);
  assert.equal(lineDiff("x", "x").lines.every((l) => l.op !== "add" && l.op !== "del"), true);
  assert.equal(lineDiff("a\n".repeat(5000), "b\n".repeat(5000)).tooBig, true);
});
