import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../core/node/store.js";

const TOKEN = "test-token-sha256";
const PRE_ID = "11111111-2222-3333-4444-555555555555";
const PRE_CONTENT = "Hello from pre-existing file without sha256\n";
const PRE_SHA = createHash("sha256").update(PRE_CONTENT).digest("hex");

const RETRY_ID = "22222222-3333-4444-5555-666666666666";
const RETRY_CONTENT = "Content written later for retry test\n";
const RETRY_SHA = createHash("sha256").update(RETRY_CONTENT).digest("hex");

let hg, base, data;

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  data = mkdtempSync(join(tmpdir(), "hg-sha256-"));
  const driveDir = join(data, "drive");
  mkdirSync(driveDir, { recursive: true });

  // Pre-seed database with a row having sha256 = null
  const db = new Store(join(data, "hourglass.db"));
  db.upsert("files", { id: PRE_ID, name: "legacy.txt", size: PRE_CONTENT.length, mime: "text/plain" });
  // And its bytes in driveDir
  writeFileSync(join(driveDir, PRE_ID), PRE_CONTENT);

  // Pre-seed another row whose bytes are NOT yet created (will fail initially then retry)
  db.upsert("files", { id: RETRY_ID, name: "retry.txt", size: RETRY_CONTENT.length, mime: "text/plain" });
  db.db.close();

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HOURGLASS_DATA: data,
    HOURGLASS_PORT: String(port),
    HOURGLASS_HOST: "127.0.0.1",
    HOURGLASS_TOKEN: TOKEN,
    MARO_ACCOUNT_URL: "http://127.0.0.1:9",
    HOURGLASS_URL: base,
    HOURGLASS_BACKFILL_RETRY_MS: "300",
  };
  delete env.HOURGLASS_ASSISTANT;

  hg = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes(`127.0.0.1:${port}`)) resolve(child);
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
});

after(async () => {
  await new Promise((r) => {
    if (hg.exitCode !== null) return r();
    hg.removeAllListeners("exit");
    hg.once("exit", r);
    hg.kill();
  });
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
});

test("upload sets the right hash", async () => {
  const content = "Contents of uploaded file!\n";
  const expectedSha = createHash("sha256").update(content).digest("hex");
  const res = await fetch(`${base}/api/files/upload?name=upload-test.txt`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: content,
  });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.size, content.length);
  assert.equal(row.sha256, expectedSha);

  const getRes = await fetch(`${base}/api/files/${row.id}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(getRes.status, 200);
  const saved = await getRes.json();
  assert.equal(saved.sha256, expectedSha);
});

test("PUT updates it", async () => {
  // Upload initial file
  const initial = "Initial file bytes";
  const upRes = await fetch(`${base}/api/files/upload?name=put-test.txt`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: initial,
  });
  assert.equal(upRes.status, 201);
  const file = await upRes.json();

  // PUT new contents
  const updated = "Updated file contents with new bytes";
  const updatedSha = createHash("sha256").update(updated).digest("hex");
  const putRes = await fetch(`${base}/api/files/${file.id}/raw`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: updated,
  });
  assert.equal(putRes.status, 200);
  const row = await putRes.json();
  assert.equal(row.size, updated.length);
  assert.equal(row.sha256, updatedSha);

  const getRes = await fetch(`${base}/api/files/${file.id}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(getRes.status, 200);
  const saved = await getRes.json();
  assert.equal(saved.sha256, updatedSha);
});

test("restore sets the restored contents' hash", async () => {
  const v1 = "Version 1 contents";
  const v1Sha = createHash("sha256").update(v1).digest("hex");
  const upRes = await fetch(`${base}/api/files/upload?name=restore-test.txt`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: v1,
  });
  const file = await upRes.json();

  // Overwrite with v2
  const v2 = "Version 2 contents replacing v1";
  await fetch(`${base}/api/files/${file.id}/raw`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: v2,
  });

  // Get versions
  const listRes = await fetch(`${base}/api/files/${file.id}/versions`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const { versions } = await listRes.json();
  assert.ok(versions.length >= 1);
  const vid = versions[0].id;

  // Restore v1
  const restoreRes = await fetch(`${base}/api/files/${file.id}/versions/${vid}/restore`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(restoreRes.status, 200);
  const restored = await restoreRes.json();
  assert.equal(restored.size, v1.length);
  assert.equal(restored.sha256, v1Sha);

  const getRes = await fetch(`${base}/api/files/${file.id}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(getRes.status, 200);
  const saved = await getRes.json();
  assert.equal(saved.sha256, v1Sha);
});

test("backfill fills a row that had none", async () => {
  // PRE_ID was seeded before startup with sha256: null.
  // Poll until backfill computes sha256.
  let row;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${base}/api/files/${PRE_ID}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    row = await res.json();
    if (row.sha256) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(row.sha256, PRE_SHA);
  assert.ok(row.rev > 1, "rev was bumped by backfill upsert");

  // Also test retry after failure: write bytes for RETRY_ID now, and verify it retries and fills
  writeFileSync(join(data, "drive", RETRY_ID), RETRY_CONTENT);
  let retryRow;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${base}/api/files/${RETRY_ID}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    retryRow = await res.json();
    if (retryRow.sha256) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(retryRow.sha256, RETRY_SHA);
});

test("a client-sent sha256 is ignored", async () => {
  // 1. Upload a file so it has an authoritative sha256
  const orig = "Server authoritative contents";
  const origSha = createHash("sha256").update(orig).digest("hex");
  const upRes = await fetch(`${base}/api/files/upload?name=client-test.txt`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: orig,
  });
  const file = await upRes.json();
  assert.equal(file.sha256, origSha);

  // 2. Client pushes a change via /api/sync attempting to change sha256
  const syncRes = await fetch(`${base}/api/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      changes: {
        files: [
          {
            id: file.id,
            name: "renamed-by-client.txt",
            size: file.size,
            mime: file.mime,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            updated_at: Date.now() + 5000,
          },
        ],
      },
    }),
  });
  assert.equal(syncRes.status, 200);

  // Check that the rename applied, but sha256 stayed at the server value
  const checkRes = await fetch(`${base}/api/files/${file.id}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const checkRow = await checkRes.json();
  assert.equal(checkRow.name, "renamed-by-client.txt");
  assert.equal(checkRow.sha256, origSha);

  // 3. Client pushes a brand new row with a forged sha256
  const newId = "99999999-8888-7777-6666-555555555555";
  const newSyncRes = await fetch(`${base}/api/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      changes: {
        files: [
          {
            id: newId,
            name: "forged.txt",
            size: 100,
            mime: "text/plain",
            sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            updated_at: Date.now() + 5000,
          },
        ],
      },
    }),
  });
  assert.equal(newSyncRes.status, 200);

  const checkNew = await (await fetch(`${base}/api/files/${newId}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  assert.equal(checkNew.name, "forged.txt");
  assert.equal(checkNew.sha256, null);
});
