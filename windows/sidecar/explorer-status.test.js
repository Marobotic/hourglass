import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createExplorerStatus, coursesRootForPair, explorerStatusEnabled, makeStatusListing } from "./explorer-status.js";

test("Explorer status is on by default on Windows and can be disabled", () => {
  assert.equal(explorerStatusEnabled({}, "win32"), true);
  assert.equal(explorerStatusEnabled({ HOURGLASS_EXPLORER_STATUS: "on" }, "win32"), true);
  assert.equal(explorerStatusEnabled({ HOURGLASS_EXPLORER_STATUS: "off" }, "win32"), false);
  assert.equal(explorerStatusEnabled({ HOURGLASS_EXPLORER_STATUS: "on" }, "linux"), false);
});

test("course pairs share the Courses navigation root", () => {
  assert.equal(coursesRootForPair({ local: "C:\\Users\\Maro\\Documents\\Courses\\Typography (1)" }), "C:\\Users\\Maro\\Documents\\Courses");
});

test("status listing classifies synced files and folders from the pair maps", async () => {
  const root = await mkdtemp(join(tmpdir(), "hourglass-explorer-"));
  try {
    await mkdir(join(root, "synced-dir"));
    await writeFile(join(root, "synced-dir", "a.txt"), "a");
    await writeFile(join(root, "new.txt"), "new");
    const listing = await makeStatusListing({ local: root, syncedFilePaths: new Map([["synced-dir/a.txt", "f1"]]), syncedFolderPaths: new Map([["synced-dir", "d1"]]), errors: [{ path: "synced-dir/a.txt" }] });
    assert.deepEqual(listing, { in_sync: ["synced-dir"], not_in_sync: ["new.txt", "synced-dir/a.txt"], errors: ["synced-dir/a.txt"] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("helper receives register, per-file status JSON and unregister calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "hourglass-explorer-helper-"));
  const calls = join(root, "calls.jsonl");
  const fake = join(root, "fake-helper.mjs");
  const folder = join(root, "pair");
  const folder2 = join(root, "pair-two");
  const children = [];
  await mkdir(folder);
  await mkdir(folder2);
  await writeFile(join(folder, "ok.txt"), "ok");
  await writeFile(join(folder, "pending.txt"), "pending");
  await writeFile(join(folder2, "ok-two.txt"), "ok");
  await writeFile(fake, `import { appendFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'; const args=process.argv.slice(2); if(args[0]==='serve'){const roots=JSON.parse(readFileSync(args[args.indexOf('--roots')+1],'utf8'));appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,roots})+'\\n');const control=args[args.indexOf('--control')+1];console.log(JSON.stringify({ok:true,connected:true}));setInterval(()=>{const f=control+'/request.json';if(!existsSync(f))return;try{const q=JSON.parse(readFileSync(f,'utf8'));const input=JSON.parse(readFileSync(q.json,'utf8'));appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:['status','--json',q.json],pair:q.pair,input})+'\\n');writeFileSync(control+'/response-'+q.id+'.json',JSON.stringify({ok:true,updated:2}));unlinkSync(f)}catch{}},25)}else{appendFileSync(${JSON.stringify(calls)},JSON.stringify({args})+'\\n');console.log(JSON.stringify({ok:true}))}`);
  try {
    const helper = createExplorerStatus({ dataDir: root, sidecarDir: root, platform: "win32", env: { HOURGLASS_EXPLORER_STATUS: "on" }, spawnImpl: (_exe, args, options) => { const child = spawn(process.execPath, [fake, ...args], options); if (args[0] === "serve") children.push(child); return child; } });
    const pair = { id: "pair-1", local: folder, syncedFilePaths: new Map([["ok.txt", "file-1"]]), syncedFolderPaths: new Map() };
    const pair2 = { id: "pair-2", local: folder2, syncedFilePaths: new Map([["ok-two.txt", "file-2"]]), syncedFolderPaths: new Map() };
    await helper.register(pair);
    await helper.register(pair2);
    assert.equal(await helper.cleanupStale(), true);
    assert.equal(await helper.registerNavigation(join(root, "courses")), true);
    assert.equal(await helper.connect(pair), true);
    assert.equal(await helper.connect(pair2), true);
    assert.equal(children.length, 1);
    children[0].kill();
    await new Promise((resolve) => setTimeout(resolve, 1250));
    assert.equal(await helper.connect(pair), true);
    assert.equal(children.length, 2);
    pair.errors = [{ path: "pending.txt" }];
    await helper.status(pair);
    pair.errors = [];
    await helper.status(pair);
    await helper.status(pair2);
    await helper.status(pair2);
    await writeFile(join(folder2, "added.txt"), "newly synced");
    pair2.syncedFilePaths.set("added.txt", "file-added");
    await helper.status(pair2);
    await helper.shutdown();
    await helper.unregister(pair);
    await helper.unregister(pair2);
    const recorded = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(recorded[0].args[0], "register");
    assert.equal(recorded[1].args[0], "register");
    assert.equal(recorded[2].args[0], "cleanup-stale");
    assert.deepEqual(recorded[3].args.slice(0, 4), ["navigation", "--path", join(root, "courses"), "--icon"]);
    const serves = recorded.filter((row) => row.args[0] === "serve");
    assert.equal(serves.length, 2);
    assert.ok(serves.every((row) => row.roots.length === 2));
    const statuses = recorded.filter((row) => row.args[0] === "status");
    assert.equal(statuses.length, 4);
    assert.ok(statuses.every((row) => row.args[row.args.indexOf("--json") + 1].startsWith(tmpdir())));
    assert.deepEqual(statuses.map((row) => row.pair), ["pair-1", "pair-1", "pair-2", "pair-2"]);
    // The sidecar removes transient roots config after stopping the helper.
    await assert.rejects(readFile(serves.at(-1).args[serves.at(-1).args.indexOf("--roots") + 1]));
    assert.deepEqual(statuses[0].input, { in_sync: ["ok.txt"], not_in_sync: ["pending.txt"], errors: ["pending.txt"] });
    assert.deepEqual(statuses[1].input.clear_errors, ["pending.txt"]);
    assert.deepEqual(statuses[2].input, { in_sync: ["ok-two.txt"], not_in_sync: [] });
    assert.deepEqual(statuses[3].input, { in_sync: ["added.txt"], not_in_sync: [] });
  } finally { for (const child of children) child.kill(); await rm(root, { recursive: true, force: true }); }
});

test("missing helper is logged and reported without throwing", async () => {
  const errors = [];
  const helper = createExplorerStatus({ sidecarDir: process.cwd(), platform: "win32", spawnImpl: () => { throw new Error("helper missing"); }, logger: (...args) => errors.push(args) });
  const pair = { id: "missing", local: process.cwd() };
  assert.equal(await helper.register(pair), false);
  assert.equal(await helper.connect(pair), false);
  assert.equal(await helper.status(pair), false);
  assert.ok(errors.length);
});
