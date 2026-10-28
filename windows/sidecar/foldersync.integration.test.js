import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../../core/node/store.js";
import { createFolderSync } from "./foldersync.js";

const TOKEN="folder-sync-integration-token";
let proc, base, data, state, engine, pairId;
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,"127.0.0.1",r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}

before(async()=>{
  data=await mkdtemp(join(tmpdir(),"hg-folder-server-")); const drive=join(data,"drive"); await mkdir(drive,{recursive:true}); await writeFile(join(drive,".hourglass-drive"),"test\n");
  const folderId=randomUUID(), db=new Store(join(data,"hourglass.db")); db.upsert("folders",{id:folderId,name:"Sync test"}); db.db.close();
  const port=await freePort();base=`http://127.0.0.1:${port}`;
  proc=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,["--no-warnings",join(import.meta.dirname,"../../server/server.js")],{env:{...process.env,HOURGLASS_DATA:data,HOURGLASS_DRIVE_DIR:drive,HOURGLASS_PORT:String(port),HOURGLASS_HOST:"127.0.0.1",HOURGLASS_TOKEN:TOKEN,HOURGLASS_URL:base,MARO_ACCOUNT_URL:"http://127.0.0.1:9"},stdio:["ignore","pipe","pipe"]});let output="";const timeout=setTimeout(()=>reject(new Error(`server did not start: ${output}`)),10000);child.stdout.on("data",chunk=>{output+=chunk;if(output.includes(`127.0.0.1:${port}`)){clearTimeout(timeout);resolve(child);}});child.stderr.on("data",chunk=>output+=chunk);child.on("exit",code=>reject(new Error(`server exited ${code}: ${output}`)));});
  state={folders:[{id:folderId,name:"Sync test",parent_id:null}],files:[]};
  const root=join(data,"local");await mkdir(root);
  engine=createFolderSync({dataDir:join(data,"sidecar"),driveDir:drive,getRows:()=>state,syncOnce:async()=>{},signedIn:()=>true,
    watchFactory:()=>({close(){},on(){}}),
    upload:async(file,{name,folder_id,existing})=>{const bytes=await import("node:fs/promises").then(fs=>fs.readFile(file));const response=await fetch(`${base}/api/files/upload?name=${encodeURIComponent(name)}&folder=${folder_id}`,{method:"POST",headers:{authorization:`Bearer ${TOKEN}`},body:bytes});assert.equal(response.status,201);const row=await response.json();state.files.push(row);return row;},
    download:async(id,target)=>{const r=await fetch(`${base}/api/files/${id}/raw`,{headers:{authorization:`Bearer ${TOKEN}`}});if(!r.ok)throw new Error(`download ${r.status}`);await writeFile(target,Buffer.from(await r.arrayBuffer()));},removeLocal:async()=>{}});
  await writeFile(join(root,"from-pc.txt"),"sync engine integration\n");
  pairId=engine.add(root,folderId).id;
});

after(async()=>{engine?.stop();if(proc)await new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once("exit",resolve);proc.kill();});if(data)await rm(data,{recursive:true,force:true,maxRetries:5});});

test("a paired local file is uploaded through the real local Drive server",async()=>{
  const until=Date.now()+7000;while(!state.files.length&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
  assert.equal(state.files.length,1,JSON.stringify(engine.list()));const row=state.files[0];assert.equal(row.name,"from-pc.txt");assert.equal(row.folder_id,state.folders[0].id);assert.match(row.sha256,/^[0-9a-f]{64}$/);
  const raw=await fetch(`${base}/api/files/${row.id}/raw`,{headers:{authorization:`Bearer ${TOKEN}`}});assert.equal(await raw.text(),"sync engine integration\n");
});
