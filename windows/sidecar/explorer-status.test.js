import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createExplorerStatus, explorerStatusEnabled, makeStatusListing } from "./explorer-status.js";

test("Explorer status is on by default on Windows and can be disabled", () => {
  assert.equal(explorerStatusEnabled({}, "win32"), true);
  assert.equal(explorerStatusEnabled({ HOURGLASS_EXPLORER_STATUS: "on" }, "win32"), true);
  assert.equal(explorerStatusEnabled({ HOURGLASS_EXPLORER_STATUS: "off" }, "win32"), false);
  assert.equal(explorerStatusEnabled({ HOURGLASS_EXPLORER_STATUS: "on" }, "linux"), false);
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
  await mkdir(folder);
  await writeFile(join(folder, "ok.txt"), "ok");
  await writeFile(join(folder, "pending.txt"), "pending");
  await writeFile(fake, `import { appendFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'; const args=process.argv.slice(2); if(args[0]==='serve'){appendFileSync(${JSON.stringify(calls)},JSON.stringify({args})+'\\n');const control=args[args.indexOf('--control')+1];console.log(JSON.stringify({ok:true,connected:true}));setInterval(()=>{const f=control+'/request.json';if(!existsSync(f))return;try{const q=JSON.parse(readFileSync(f,'utf8'));const input=JSON.parse(readFileSync(q.json,'utf8'));appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:['status','--json',q.json],input})+'\\n');writeFileSync(control+'/response-'+q.id+'.json',JSON.stringify({ok:true,updated:2}));unlinkSync(f)}catch{}},25)}else{appendFileSync(${JSON.stringify(calls)},JSON.stringify({args})+'\\n');console.log(JSON.stringify({ok:true}))}`);
  try {
    const helper = createExplorerStatus({ dataDir: root, sidecarDir: root, platform: "win32", env: { HOURGLASS_EXPLORER_STATUS: "on" }, spawnImpl: (_exe, args, options) => spawn(process.execPath, [fake, ...args], options) });
    const pair = { id: "pair-1", local: folder, syncedFilePaths: new Map([["ok.txt", "file-1"]]), syncedFolderPaths: new Map() };
    await helper.register(pair);
    assert.equal(await helper.connect(pair), true);
    await helper.status(pair);
    await helper.unregister(pair);
    const recorded = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(recorded[0].args[0], "register");
    assert.equal(recorded[1].args[0], "serve");
    assert.equal(recorded[2].args[0], "status");
    assert.ok(recorded[2].args[recorded[2].args.indexOf("--json") + 1].startsWith(tmpdir()));
    assert.equal(recorded[3].args[0], "unregister");
    // The helper owns and removes the transient input file after it exits.
    await assert.rejects(readFile(recorded[1].args[recorded[1].args.indexOf("--json") + 1]));
    assert.deepEqual(recorded[2].input, { in_sync: ["ok.txt"], not_in_sync: ["pending.txt"] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
