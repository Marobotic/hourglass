import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { compareTrees, createFolderSync } from "./foldersync.js";

const file=(sha256, extra={})=>({sha256,size:10,mtime:1,...extra});

test("first pairing uploads local only, downloads remote only, and records identical hashes",()=>{
  const p=compareTrees({"local.txt":file("a"),"same.txt":file("x")},{"remote.txt":file("b",{file_id:"r"}),"same.txt":file("x",{file_id:"s"})},{},{stable:new Set(["local.txt","same.txt"])});
  assert.deepEqual(p.actions.map(x=>x.type).sort(),["download","record","upload"]);
});

test("changed local uploads and changed remote downloads",()=>{
  const base={old:{file_id:"id",sha256:"a"}};
  const p=compareTrees({old:file("b")},{old:file("a",{file_id:"id"})},{files:base},{stable:new Set(["old"])});
  assert.equal(p.actions[0].type,"upload");
  const q=compareTrees({old:file("a")},{old:file("b",{file_id:"id"})},{files:base},{stable:new Set(["old"])});
  assert.equal(q.actions[0].type,"download");
});

test("simultaneous and first-pair differing files keep a timestamped conflict copy",()=>{
  const now=new Date(2026,9,28,9,4),base={files:{x:{file_id:"id",sha256:"a"}}};
  const p=compareTrees({"report.txt":file("local")},{"report.txt":file("remote",{file_id:"r"})},{},{device:"Maro-PC",now,stable:new Set(["report.txt"])});
  assert.equal(p.actions[0].type,"conflict");
  assert.equal(p.actions[0].conflict,"report (conflict, Maro-PC 2026-10-28 09.04).txt");
  const q=compareTrees({x:file("local")},{x:file("remote",{file_id:"id"})},base,{stable:new Set(["x"]),now});
  assert.equal(q.actions[0].type,"conflict");
});

test("remote rename follows file id and local move follows matching base hash",()=>{
  const base={files:{"old/a.txt":{file_id:"id",sha256:"a"}}};
  const remote=compareTrees({"old/a.txt":file("a")},{"new/a.txt":file("a",{file_id:"id"})},base,{stable:new Set(["old/a.txt"])});
  assert.deepEqual(remote.actions.map(a=>a.type),["remote_move"]);
  const local=compareTrees({"new/a.txt":file("a")},{"old/a.txt":file("a",{file_id:"id"})},base,{stable:new Set(["new/a.txt"])});
  assert.deepEqual(local.actions.map(a=>a.type),["local_move"]);
});

test("local and remote deletions are planned; mass deletion suppresses both sides",()=>{
  const base={files:{a:{file_id:"a",sha256:"1"},b:{file_id:"b",sha256:"2"},c:{file_id:"c",sha256:"3"},d:{file_id:"d",sha256:"4"}}};
  const one=compareTrees({a:file("1"),b:file("2"),c:file("3")},{a:file("1",{file_id:"a"}),b:file("2",{file_id:"b"}),c:file("3",{file_id:"c"}),d:file("4",{file_id:"d"})},base);
  assert(one.actions.some(a=>a.type==="delete_remote"));
  const mass=compareTrees({a:file("1")},{a:file("1",{file_id:"a"}),b:file("2",{file_id:"b"}),c:file("3",{file_id:"c"}),d:file("4",{file_id:"d"})},base);
  assert.equal(mass.massDelete,true);
  assert(!mass.actions.some(a=>a.type.startsWith("delete_")));
});

test("unstable local writes do not trigger an upload or overwrite a remote first-pair file",()=>{
  const p=compareTrees({}, {same:file("remote",{file_id:"r"})}, {}, {pending:new Set(["same"])});
  assert.deepEqual(p.actions,[]);
});

test("a missing sync root pauses the pair rather than planning deletions",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"hg-folder-root-")), data=join(temp,"data"), root=join(temp,"local");
  await mkdir(data); await mkdir(root);
  const engine=createFolderSync({dataDir:data,driveDir:join(temp,"drive"),getRows:()=>({folders:[],files:[]}),syncOnce:async()=>{},upload:async()=>{},download:async()=>{},removeLocal:async()=>{},signedIn:()=>false,watchFactory:()=>Object.assign(new EventEmitter(),{close(){}})});
  const pair=engine.add(root,"folder"); await new Promise(r=>setTimeout(r,10)); await rm(root,{recursive:true}); await engine.run(pair.id);
  assert.equal(engine.list()[0].state,"paused"); assert.equal(engine.list()[0].reason,"root_unreadable");
  engine.stop(); await rm(temp,{recursive:true,force:true});
});
