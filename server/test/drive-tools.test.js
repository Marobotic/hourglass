import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../core/node/store.js";
import { Service } from "../../core/node/service.js";
import { createVersions } from "../versions.js";
import { createDriveTools } from "../drive-tools.js";
import { needsApproval, TOOLS } from "../tools.js";
import { cardsFor } from "../cards.js";

test("Drive assistant tools read, edit, version, restore, create, rename and delete with hash metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "hg-drive-tools-"));
  try {
    const t = { email: "owner@example.test", dir: root, store: new Store(join(root, "db.sqlite")) };
    t.service = new Service(t.store);
    const drive = join(root, "drive"); mkdirSync(drive);
    const drivePath = (_t, id) => join(drive, id);
    const versions = createVersions({ drivePath });
    t.service.driveFiles = createDriveTools(t, { drivePath, versions });
    const id = randomUUID(), content = "alpha\nbeta\n";
    writeFileSync(drivePath(t, id), content);
    t.store.upsert("files", { id, name: "notes.txt", size: Buffer.byteLength(content), mime: "text/plain", sha256: createHash("sha256").update(content).digest("hex") });
    assert.equal(t.service.driveFiles.permissionFor("write_file", { path: "notes.txt" }), "risky");
    assert.equal(t.service.driveFiles.permissionFor("write_file", { path: "new.md" }), undefined);
    assert.equal(needsApproval("auto", "write_file", t.service, { path: "notes.txt" }), true);
    assert.equal(needsApproval("auto", "write_file", t.service, { path: "new.md" }), false);
    assert.equal(needsApproval("ask", "write_file", t.service, { path: "new.md" }), true);
    assert.equal(needsApproval("dangerous", "delete_file", t.service, { file_id: id }), false);
    const proposedHash = t.service.driveFiles.hashFor("write_file", { path: "notes.txt" });
    writeFileSync(drivePath(t, id), "changed elsewhere\n");
    assert.notEqual(t.service.driveFiles.hashFor("write_file", { path: "notes.txt" }), proposedHash);
    assert.throws(() => t.service.driveFiles.assertUnchanged("write_file", { path: "notes.txt" }, proposedHash), /changed after the proposal/);
    t.service.driveFiles.write({ path: "new-file.txt", content: "created concurrently" });
    assert.throws(() => t.service.driveFiles.assertUnchanged("write_file", { path: "new-file.txt" }, null), /changed after the proposal/);
    writeFileSync(drivePath(t, id), content);
    versions.started(t, id, { by: "owner@example.test" }, Buffer.byteLength(content));
    assert.equal(t.service.driveFiles.read({ file_id: id, limit: 5 }).content, "alpha");
    const edited = t.service.driveFiles.edit({ file_id: id, old_text: "beta", new_text: "gamma\ndelta" });
    assert.equal(edited.changes.added, 2);
    assert.equal(edited.changes.removed, 1);
    assert.equal(edited.size, Buffer.byteLength("alpha\ngamma\ndelta\n"));
    assert.equal(edited.sha256, createHash("sha256").update(readFileSync(drivePath(t, id))).digest("hex"));
    assert.equal(t.service.driveFiles.listVersions({ file_id: id }).versions.length, 1);
    const version = t.service.driveFiles.listVersions({ file_id: id }).versions[0];
    t.service.driveFiles.restore({ file_id: id, version_id: version.id });
    assert.equal(readFileSync(drivePath(t, id), "utf8"), content);
    const created = t.service.driveFiles.write({ path: "new.md", content: "one\ntwo" });
    assert.equal(created.created, true);
    assert.equal(created.sha256, createHash("sha256").update("one\ntwo").digest("hex"));
    assert.deepEqual(cardsFor(t.service, "write_file", { path: "new.md" }, created)[0], {
      kind: "file", id: created.id, file_id: created.id, name: "new.md", label: "new.md", size: 7,
      state: "created", added: 2, removed: 0, diff: { added: 2, removed: 0 },
    });
    assert.equal(t.service.driveFiles.rename({ file_id: created.id, name: "renamed.md" }).name, "renamed.md");
    t.service.driveFiles.delete({ file_id: created.id });
    assert.equal(t.store.get("files", created.id).deleted, 1);
    assert.ok(t.service.driveFiles.listVersions({ file_id: created.id }).versions.length);
    assert.throws(() => t.service.driveFiles.edit({ file_id: id, old_text: "", new_text: "x" }), /exactly once/);
    assert.throws(() => t.service.driveFiles.read({ file_id: "missing" }), /not found/);
    t.store.db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("every new Drive tool declares a permission class", () => {
  for (const name of ["read_file", "write_file", "edit_file", "delete_file", "rename_file", "list_file_versions", "restore_file_version"]) {
    const tool = TOOLS.find((x) => x.name === name);
    assert.ok(tool);
    assert.ok(["read", "change", "risky"].includes(tool.permission));
  }
});
