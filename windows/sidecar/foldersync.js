import { createHash, randomUUID } from "node:crypto";
import { watch, readdir, stat, mkdir, rename } from "node:fs/promises";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const ignored = (name) => name === "desktop.ini" || name === "Thumbs.db" || name === ".DS_Store" || name.startsWith("~$") || /\.(tmp|part|crdownload)$/i.test(name);
const within = (a, b) => { const r = relative(resolve(a), resolve(b)); return !r.startsWith("..") && !resolve(a).startsWith(resolve(b) + sep) && (r === "" || !r.startsWith(".." + sep)); };
const same = (a, b) => !!a && !!b && a.sha256 === b.sha256;
async function hashFile(path) { const hash=createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
const conflictName = (path, device, date = new Date()) => {
  const ext = extname(path), stem = basename(path, ext);
  const stamp = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")} ${String(date.getHours()).padStart(2,"0")}.${String(date.getMinutes()).padStart(2,"0")}`;
  return `${stem} (conflict, ${device} ${stamp})${ext}`;
};

// Pure three-way planner. Trees are maps keyed by normalized relative path.
export function compareTrees(local, remote, base, { device = "PC", now = new Date(), stable = new Set(), pending = new Set(), maxDeletes = 20 } = {}) {
  const actions = [], ltree = local.files || local, rtree = remote.files || remote, btree = base.files || base;
  const paths = new Set([...Object.keys(ltree), ...Object.keys(rtree), ...Object.keys(btree)]), consumed = new Set();
  // File ids identify remote moves; matching a local hash identifies local moves.
  for (const [oldPath, b] of Object.entries(btree)) {
    if (!ltree[oldPath]) {
      const movedLocal = Object.entries(ltree).find(([p, l]) => p !== oldPath && !btree[p] && l.sha256 === b.sha256 && stable.has(p));
      if (movedLocal) { actions.push({ type:"local_move", from:oldPath, path:movedLocal[0], file_id:b.file_id, local:movedLocal[1] }); consumed.add(oldPath); consumed.add(movedLocal[0]); continue; }
    }
    if (rtree[oldPath] || !ltree[oldPath]) continue;
    const moved = Object.entries(rtree).find(([p, r]) => p !== oldPath && r.file_id === b.file_id);
    if (moved) { actions.push({ type:"remote_move", from:oldPath, path:moved[0], remote:moved[1] }); consumed.add(oldPath); consumed.add(moved[0]); continue; }
  }
  let deleteLocal = 0, deleteRemote = 0;
  for (const path of paths) {
    if(consumed.has(path)) continue;
    const l = ltree[path], r = rtree[path], b = btree[path];
    if (!l && pending.has(path)) continue;
    if (!b) {
      if (l && r) {
        if (same(l, r)) actions.push({ type: "record", path, local: l, remote: r });
        else actions.push({ type: "conflict", path, conflict: conflictName(path, device, now), local: l, remote: r });
      } else if (l && stable.has(path)) actions.push({ type: "upload", path, local: l });
      else if (r) actions.push({ type: "download", path, remote: r });
      continue;
    }
    const lc = l ? (l.sha256 === b.sha256 ? false : stable.has(path)) : false;
    const rc = r ? r.sha256 !== b.sha256 || r.file_id !== b.file_id : false;
    if (l && r) {
      if (!lc && !rc) actions.push({ type: "record", path, local: l, remote: r });
      else if (lc && !rc) actions.push({ type: "upload", path, local: l, remote: r });
      else if (!lc && rc) actions.push({ type: "download", path, remote: r });
      else if (l.sha256 === r.sha256) actions.push({ type: "record", path, local: l, remote: r });
      else actions.push({ type: "conflict", path, conflict: conflictName(path, device, now), local: l, remote: r });
    } else if (l && !r) {
      if (lc) actions.push({ type: "upload", path, local: l });
      else { actions.push({ type: "delete_local", path, file_id: b.file_id, local: l }); deleteLocal++; }
    } else if (!l && r) {
      if (rc) actions.push({ type: "download", path, remote: r });
      else { actions.push({ type: "delete_remote", path, remote: r, file_id: r.file_id }); deleteRemote++; }
    } else { actions.push({ type: "forget", path }); }
  }
  const countBase = Math.max(Object.keys(btree).length, 1);
  const massDelete = deleteLocal > maxDeletes || deleteRemote > maxDeletes || deleteLocal / countBase > .25 || deleteRemote / countBase > .25;
  return { actions: massDelete ? actions.filter((a) => !a.type.startsWith("delete_")) : actions, allActions: actions, massDelete, deleteLocal, deleteRemote };
}

export function createFolderSync({ dataDir, driveDir, getRows, syncOnce, upload, download, removeLocal, maxFile = async () => Infinity, deviceName = () => "PC", signedIn = () => true, onState = () => {}, watchFactory = watch, clock = () => Date.now() }) {
  mkdirSync(dataDir,{recursive:true});
  const file = join(dataDir, "syncfolders.json"), pairs = new Map(), timers = new Map(), watchers = new Map(), running = new Set(), settling = new Map();
  const load = () => { try { for (const p of JSON.parse(readFileSync(file,"utf8"))) pairs.set(p.id, { ...p, errors: [], state: p.paused ? "paused" : "idle", last_sync: p.last_sync || null }); } catch {} };
  const save = () => { const tmp=file+".part";writeFileSync(tmp,JSON.stringify([...pairs.values()].map(({ errors, state, pending, ...p }) => p), null, 2)+"\n");renameSync(tmp,file); };
  function view(p) { return { id:p.id, local:p.local, folder_id:p.folder_id, folder_path:folderPath(p.folder_id), state:p.state, reason:p.reason || null, last_sync:p.last_sync, pending:p.pending || 0, errors:p.errors || [] }; }
  function folderPath(id) {
    const rows = getRows().folders || []; const names=[]; let f=rows.find(x=>x.id===id); const seen=new Set();
    while(f && !seen.has(f.id)){seen.add(f.id); names.unshift(f.name); f=rows.find(x=>x.id===f.parent_id);}
    return ["Drive",...names].join("/");
  }
  function emit(p) { onState(view(p)); }
  function schedule(p, ms=2000) { clearTimeout(timers.get(p.id)); timers.set(p.id,setTimeout(()=>run(p.id),ms)); }
  function startWatch(p) {
    try { watchers.get(p.id)?.close(); const w=watchFactory(p.local,{recursive:true},()=>schedule(p,2000)); w.on?.("error",e=>pause(p,"root_unreadable",e.message)); watchers.set(p.id,w); }
    catch(e){ pause(p,"root_unreadable",e.message); }
  }
  function pause(p, reason, message) { p.paused=true; p.reason=reason; p.state="paused"; p.errors=message?[{path:p.local,error:message}]:[]; watchers.get(p.id)?.close(); watchers.delete(p.id); save(); emit(p); }
  async function scan(root, prior={}) {
    const files={}, folders={"":null}, pending=[];
    async function walk(dir, rel="") {
      const entries=await readdir(dir,{withFileTypes:true});
      for(const ent of entries){ if(ignored(ent.name)) continue; const abs=join(dir,ent.name), rp=rel?`${rel}/${ent.name}`:ent.name;
        if(within(driveDir,abs)) continue;
        if(ent.isDirectory()){ folders[rp]=null; await walk(abs,rp); }
        else if(ent.isFile()){ const st=await stat(abs); let sha;
          const old=prior.files?.[rp]; if(old&&old.mtime===st.mtimeMs&&old.size===st.size) sha=old.sha256;
          else {const k=`${root}\0${rp}`, seen=settling.get(k); if(seen?.size===st.size&&seen.mtime===st.mtimeMs&&seen.sha256) sha=seen.sha256;
            else if(!seen||seen.size!==st.size||seen.mtime!==st.mtimeMs){settling.set(k,{size:st.size,mtime:st.mtimeMs});pending.push(rp);continue;}
            else {sha=await hashFile(abs);const after=await stat(abs);if(after.size!==st.size||after.mtimeMs!==st.mtimeMs){settling.set(k,{size:after.size,mtime:after.mtimeMs});pending.push(rp);continue;}settling.set(k,{size:st.size,mtime:st.mtimeMs,sha256:sha});}}
          files[rp]={path:abs,sha256:sha,mtime:st.mtimeMs,size:st.size};
        }
      }
    }
    await walk(root); return {files,folders,pending};
  }
  function remoteTree(folderId) {
    const rows=getRows(), fs=rows.folders||[], files=rows.files||[], folders={}, out={};
    const descend=(id,prefix)=>{for(const f of fs.filter(x=>(x.parent_id||null)===(id||null)&&!x.deleted)){const path=prefix?`${prefix}/${f.name}`:f.name; folders[path]=f.id; descend(f.id,path);}};
    descend(folderId,"");
    for(const r of files.filter(x=>!x.deleted)){ let path="", parent=r.folder_id; const seg=[r.name], seen=new Set(); while(parent&&parent!==folderId&&!seen.has(parent)){seen.add(parent);const f=fs.find(x=>x.id===parent&&!x.deleted);if(!f)break;seg.unshift(f.name);parent=f.parent_id;} if(parent!==folderId)continue; path=seg.join("/"); out[path]={file_id:r.id,sha256:r.sha256||"",size:r.size,updated_at:r.updated_at,folder_id:r.folder_id,name:r.name}; }
    return {files:out,folders};
  }
  async function run(id) {
    const p=pairs.get(id); if(!p||p.paused||running.has(id))return; running.add(id); p.state="syncing"; p.errors=[]; p.pending=0; emit(p);
    try {
      if(!existsSync(p.local)) throw Object.assign(new Error("The synced folder is missing or unreadable."),{pause:"root_unreadable"});
      await readdir(p.local);
      if(!signedIn()) {p.state="idle";return;}
      if(!(getRows().folders||[]).some(f=>f.id===p.folder_id&&!f.deleted)) throw Object.assign(new Error("The paired Drive folder is missing."),{pause:"drive_folder_missing"});
      const local=await scan(p.local,p.base||{}); for(const folder of Object.keys(local.folders).filter(Boolean)) await ensureFolders(p,`${folder}/_folder`);
      let remote=remoteTree(p.folder_id); for(const folder of Object.keys(remote.folders)) await mkdir(join(p.local,...folder.split("/")),{recursive:true});
      const stable=new Set(Object.keys(local.files));
      remote=remoteTree(p.folder_id);
      const plan=compareTrees(local,remote,p.base||{},{device:deviceName(),stable,pending:new Set(local.pending)});
      if(plan.massDelete){p.pending=plan.allActions.length;p.pendingDeletes={...plan,actions:plan.allActions};pause(p,"mass_delete"); return;}
      p.pending=plan.actions.length;
      for(const a of plan.actions){
        if(!pairs.has(id)) return;
        if(a.type==="download") await downloadAction(p,a,local);
        else if(a.type==="upload") await uploadAction(p,a,local);
        else if(a.type==="remote_move") { const from=join(p.local,...a.from.split("/")), to=join(p.local,...a.path.split("/")); await mkdir(dirname(to),{recursive:true}); await rename(from,to); const old=p.base.files?.[a.from];if(old){delete p.base.files[a.from];p.base.files[a.path]=old;save();} }
        else if(a.type==="local_move") { const parent=await ensureFolders(p,a.path); const row=(getRows().files||[]).find(x=>x.id===a.file_id); if(row) getRows().moveFile?.(row.id,basename(a.path),parent); }
        else if(a.type==="conflict") {const from=local.files[a.path].path,to=join(dirname(from),a.conflict);await rename(from,to);if(p.base.files?.[a.path]){delete p.base.files[a.path];save();}await uploadAction(p,{path:relative(p.local,to).split(sep).join("/"),local:{...local.files[a.path],path:to}},local);}
        else if(a.type==="delete_remote"){const row=(getRows().files||[]).find(x=>x.id===a.file_id);if(row) getRows().removeFile?.(row.id);}
        else if(a.type==="delete_local") await removeLocal(join(p.local,...a.path.split("/")));
        else if(a.type==="record") {}
        p.pending--;
      }
      if(!pairs.has(id)) return;
      await syncOnce();
      const afterLocal=await scan(p.local,p.base||{}), afterRemote=remoteTree(p.folder_id), base={files:{},folders:{...afterRemote.folders}};
      for(const [path,l] of Object.entries(afterLocal.files)){const r=afterRemote.files[path];if(r&&l.sha256===r.sha256)base.files[path]={file_id:r.file_id,sha256:r.sha256,mtime:l.mtime,size:l.size};else if(p.base?.files?.[path])base.files[path]=p.base.files[path];}
      p.base=base;p.last_sync=clock();p.state=p.errors.length?"error":"idle";p.reason=null;save();
      if(local.pending.length) schedule(p,2000);
    } catch(e){ p.pending=0;if(e.pause||["ENOENT","EACCES","EPERM"].includes(e.code)) pause(p,e.pause||"root_unreadable",e.message); else {p.state="error";p.errors=[{path:p.local,error:e.message}];emit(p);} }
    finally {running.delete(id);emit(p);}
  }
  async function ensureFolders(p, path) {
    const names=path.split("/").slice(0,-1); let parent=p.folder_id, current=""; const rows=getRows();
    for(const name of names){current=current?`${current}/${name}`:name;let row=(rows.folders||[]).find(f=>f.name===name&&(f.parent_id||null)===(parent||null)&&!f.deleted);if(!row){row=rows.createFolder(name,parent);await syncOnce();}parent=row.id;}
    return parent;
  }
  async function uploadAction(p,a,local){const path=a.path, item=a.local, size=(await stat(item.path)).size, max=await maxFile();if(size>max){p.errors.push({path,error:`File is over the ${Math.round(max/1048576)} MB upload limit.`});return;}const parent=await ensureFolders(p,path), remote=remoteTree(p.folder_id).files[path];await upload(item.path,{name:basename(path),folder_id:parent,existing:remote?.file_id||a.remote?.file_id});}
  async function downloadAction(p,a,local){const target=join(p.local,...a.path.split("/"));await mkdir(dirname(target),{recursive:true});const tmp=target+".part";await download(a.remote.file_id,tmp);await rename(tmp,target);}
  function add(local, folder_id){const p={id:randomUUID(),local:resolve(local),folder_id,paused:false,base:{files:{},folders:{}},state:"idle",errors:[],last_sync:null};pairs.set(p.id,p);save();startWatch(p);run(p.id);return view(p);}
  function command(id,action){const p=pairs.get(id);if(!p)return null;if(action==="pause")pause(p,"user");else if(action==="resume"){p.paused=false;p.reason=null;startWatch(p);run(id);}else if(action==="now")run(id);else if(action==="confirm"||action==="keep"){
    const pending=p.pendingDeletes; p.paused=false;p.reason=null;delete p.pendingDeletes;startWatch(p);
    if(pending){ const runActions=async()=>{for(const a of pending.actions){if(action==="confirm"&&a.type==="delete_remote")getRows().removeFile?.(a.file_id);else if(action==="confirm"&&a.type==="delete_local")await removeLocal(join(p.local,...a.path.split("/")));else if(action==="keep"&&a.type==="delete_remote")await downloadAction(p,{path:a.path,remote:a.remote},{});else if(action==="keep"&&a.type==="delete_local")await uploadAction(p,{path:a.path,local:a.local},{});}await syncOnce();p.base={files:{},folders:{}};run(id);};runActions().catch(e=>{p.state="error";p.errors=[{path:p.local,error:e.message}];emit(p);});}
    else run(id);
  }return view(p);}
  function remove(id){const p=pairs.get(id);if(!p)return false;watchers.get(id)?.close();clearTimeout(timers.get(id));pairs.delete(id);save();return true;}
  load(); for(const p of pairs.values())if(!p.paused)startWatch(p);
  const interval=setInterval(()=>{for(const p of pairs.values())schedule(p,0);},30000); interval.unref?.();
  return {list:()=>[...pairs.values()].map(view),add,command,remove,run,stop:()=>{clearInterval(interval);for(const w of watchers.values())w.close();}};
}

