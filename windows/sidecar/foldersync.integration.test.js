import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../core/node/store.js";
import { createFolderSync } from "./foldersync.js";

const TOKEN = "folder-sync-integration-token";
let serverProcess;
let serverBase;
let dataDir;
let replica;
let engine;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(port, driveDir) {
  const entry = join(import.meta.dirname, "../../server/server.js");
  const env = {
    ...process.env,
    HOURGLASS_DATA: dataDir,
    HOURGLASS_DRIVE_DIR: driveDir,
    HOURGLASS_PORT: String(port),
    HOURGLASS_HOST: "127.0.0.1",
    HOURGLASS_TOKEN: TOKEN,
    HOURGLASS_URL: serverBase,
    MARO_ACCOUNT_URL: "http://127.0.0.1:9",
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", entry], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes(`127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${output}`)));
  });
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hg-folder-server-"));
  const driveDir = join(dataDir, "drive");
  await mkdir(driveDir, { recursive: true });
  await writeFile(join(driveDir, ".hourglass-drive"), "test\n");

  const folderId = randomUUID();
  const db = new Store(join(dataDir, "hourglass.db"));
  db.upsert("folders", { id: folderId, name: "Sync test" });
  db.db.close();

  const port = await freePort();
  serverBase = `http://127.0.0.1:${port}`;
  serverProcess = await startServer(port, driveDir);
  replica = {
    folders: [{ id: folderId, name: "Sync test", parent_id: null }],
    files: [],
  };

  const localRoot = join(dataDir, "local");
  await mkdir(localRoot);
  engine = createFolderSync({
    dataDir: join(dataDir, "sidecar"),
    driveDir,
    getRows: () => replica,
    syncOnce: async () => {},
    signedIn: () => true,
    watchFactory: () => ({ close() {}, on() {} }),
    upload: async (path, options) => {
      const bytes = await readFile(path);
      const query = new URLSearchParams({ name: options.name, folder: options.folder_id });
      const response = await fetch(`${serverBase}/api/files/upload?${query}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: bytes,
      });
      assert.equal(response.status, 201);
      const row = await response.json();
      replica.files.push(row);
      return row;
    },
    download: async (id, target) => {
      const response = await fetch(`${serverBase}/api/files/${id}/raw`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (!response.ok) throw new Error(`download ${response.status}`);
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
    },
    removeLocal: async () => {},
  });

  await writeFile(join(localRoot, "from-pc.txt"), "sync engine integration\n");
  engine.add(localRoot, folderId);
});

after(async () => {
  engine?.stop();
  if (serverProcess) {
    await new Promise((resolve) => {
      if (serverProcess.exitCode !== null) return resolve();
      serverProcess.once("exit", resolve);
      serverProcess.kill();
    });
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

test("a paired local file is uploaded through the real local Drive server", async () => {
  const until = Date.now() + 7000;
  while (!replica.files.length && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(replica.files.length, 1, JSON.stringify(engine.list()));
  const row = replica.files[0];
  assert.equal(row.name, "from-pc.txt");
  assert.equal(row.folder_id, replica.folders[0].id);
  assert.match(row.sha256, /^[0-9a-f]{64}$/);

  const response = await fetch(`${serverBase}/api/files/${row.id}/raw`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(await response.text(), "sync engine integration\n");
});
