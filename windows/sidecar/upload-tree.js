// A folder dropped on the window: what is in it, and sending all of it.
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

// Explorer's and Office's own files, and hidden ones: never uploaded.
export const isJunk = (name) => /^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(name) || name.startsWith("~$") || name.startsWith(".");

// { name, files: [{ name, path }], folders: [same] }. Links and junctions are
// not followed, so a folder can't lead back into itself.
export function readTree(dir) {
  const tree = { name: basename(dir), files: [], folders: [] };
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (isJunk(e.name) || e.isSymbolicLink()) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) tree.folders.push(readTree(path));
    else if (e.isFile()) tree.files.push({ name: e.name, path });
  }
  return tree;
}

// The folders come along (addFolder(name, parentId) makes each one; parent: where the
// dropped folder goes, null = the top). A note holds no folders (flat): every file goes
// straight into it. One file failing doesn't stop the rest.
export async function uploadTree(tree, { flat = false, parent = null, addFolder, upload }) {
  const out = { folder: null, files: [], failed: [] };
  const send = async (t, into) => {
    for (const f of t.files) {
      try {
        out.files.push(await upload(f, into));
      } catch (e) {
        out.failed.push({ name: f.name, error: e.message });
      }
    }
    for (const sub of t.folders) {
      if (flat) { await send(sub, into); continue; }
      let made;
      try {
        made = await addFolder(sub.name, into);
      } catch (e) {
        out.failed.push({ name: sub.name, error: e.message });
        continue;
      }
      await send(sub, made.id);
    }
  };
  if (flat) await send(tree, parent);
  else {
    out.folder = await addFolder(tree.name, parent);
    await send(tree, out.folder.id);
  }
  return out;
}
