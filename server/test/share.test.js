// Drive links (share.js), end to end against the real server: making a link,
// the public page and file with no sign-in, folder links that open only their
// folder, access, expiry and "Stop sharing".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "owner-token-for-share-tests";
let hg, base, data;

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  data = mkdtempSync(join(tmpdir(), "hg-share-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOURGLASS_DATA: data, HOURGLASS_PORT: String(port), HOURGLASS_HOST: "127.0.0.1", HOURGLASS_TOKEN: TOKEN, MARO_ACCOUNT_URL: "http://127.0.0.1:9", HOURGLASS_URL: base };
  delete env.HOURGLASS_ASSISTANT;
  hg = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; if (out.includes(`127.0.0.1:${port}`)) resolve(child); });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
});

after(async () => {
  await new Promise((r) => { if (hg.exitCode !== null) return r(); hg.removeAllListeners("exit"); hg.once("exit", r); hg.kill(); });
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const action = async (name, args) => (await call("POST", `/api/actions/${name}`, args)).body;
async function upload(name, bytes, folder) {
  const r = await fetch(`${base}/api/files/upload?name=${encodeURIComponent(name)}${folder ? `&folder=${folder}` : ""}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: bytes });
  assert.equal(r.status, 201);
  return r.json();
}
const open = (url, headers = {}) => fetch(url, { headers }); // no sign-in

test("a file link: page, bytes, ranges, access, then stop sharing", async () => {
  const f = await upload("notes.txt", Buffer.from("hello from hourglass\n"));
  const s = (await call("POST", "/api/shares", { file_id: f.id, access: "view" })).body;
  assert.match(s.url, new RegExp(`^${base}/drive/[A-Za-z0-9_-]{22}$`));
  assert.equal(s.access, "view");
  assert.equal(s.active, true);

  const page = await open(s.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<h1>notes\.txt<\/h1>/);
  assert.match(html, /hello from hourglass/); // text shows inline
  assert.doesNotMatch(html, /Download<\/a>/); // view only

  const raw = await open(s.url + "/raw?download=1");
  assert.equal(await raw.text(), "hello from hourglass\n");
  assert.match(raw.headers.get("content-disposition"), /^inline/); // view only: no attachment
  assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
  assert.match(raw.headers.get("content-security-policy"), /sandbox/);
  const part = await open(s.url + "/raw", { range: "bytes=0-4" });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), "hello");

  // Sharing again changes the access and keeps the link.
  const again = (await call("POST", "/api/shares", { file_id: f.id, access: "download" })).body;
  assert.equal(again.token, s.token);
  assert.match(await (await open(s.url)).text(), /Download<\/a>/);
  assert.match((await open(s.url + "/raw?download=1")).headers.get("content-disposition"), /^attachment/);

  const list = (await call("GET", `/api/shares?file_id=${f.id}`)).body;
  assert.deepEqual(list.map((x) => x.token), [s.token]);

  assert.equal((await call("DELETE", `/api/shares/${s.token}`)).status, 200);
  assert.equal((await open(s.url)).status, 404);
  assert.equal((await open(s.url + "/raw")).status, 404);
});

test("a folder link opens that folder and what is under it, nothing else", async () => {
  const top = await action("add_folder", { name: "Trip" });
  const sub = await action("add_folder", { name: "Day 1", parent_id: top.id });
  const inside = await upload("deep.txt", Buffer.from("deep"), sub.id);
  const outside = await upload("secret.txt", Buffer.from("secret"));
  const s = (await call("POST", "/api/shares", { folder_id: top.id, access: "download" })).body;
  const page = await (await open(s.url)).text();
  assert.match(page, /Day 1/);
  const subPage = await open(`${s.url}/folder/${sub.id}`);
  assert.equal(subPage.status, 200);
  assert.match(await subPage.text(), /deep\.txt/);
  assert.equal(await (await open(`${s.url}/file/${inside.id}/raw`)).text(), "deep");
  assert.equal((await open(`${s.url}/file/${outside.id}/raw`)).status, 404);
  assert.equal((await open(`${s.url}/file/${outside.id}`)).status, 404);
  // Moving the file out of the folder takes it out of the link.
  await action("move_file", { file_id: inside.id, folder_id: null });
  assert.equal((await open(`${s.url}/file/${inside.id}/raw`)).status, 404);
});

test("files a browser would run are never shown inline", async () => {
  const f = await upload("page.html", Buffer.from("<script>alert(1)</script>"));
  const s = (await call("POST", "/api/shares", { file_id: f.id, access: "view" })).body;
  const raw = await open(s.url + "/raw");
  assert.equal(raw.headers.get("content-type"), "application/octet-stream");
  assert.match(raw.headers.get("content-disposition"), /^attachment/);
  const html = await (await open(s.url)).text();
  assert.doesNotMatch(html, /<script>alert/);
});

test("unknown links, deleted files and bad requests", async () => {
  assert.equal((await open(`${base}/drive/AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
  const f = await upload("gone.txt", Buffer.from("x"));
  const s = (await call("POST", "/api/shares", { file_id: f.id })).body;
  await fetch(`${base}/api/files/${f.id}`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal((await open(s.url)).status, 404);
  assert.equal((await call("POST", "/api/shares", {})).status, 400);
  assert.equal((await call("POST", "/api/shares", { file_id: "nope" })).status, 404);
  // Making a link needs the account.
  assert.equal((await fetch(`${base}/api/shares`, { method: "POST", body: "{}" })).status, 401);
});

test("folders move into folders, never into themselves", async () => {
  const a = await action("add_folder", { name: "A" });
  const b = await action("add_folder", { name: "B", parent_id: a.id });
  const moved = await call("POST", "/api/actions/move_folder", { folder_id: a.id, parent_id: b.id });
  assert.equal(moved.status, 400);
  assert.match(moved.body.error, /cannot go inside itself/);
  const c = await action("add_folder", { name: "C" });
  assert.equal((await action("move_folder", { folder_id: c.id, parent_id: b.id })).parent_id, b.id);
  assert.deepEqual((await action("list_drive", { folder_id: b.id })).folders.map((f) => f.name), ["C"]);
  assert.equal((await action("move_folder", { folder_id: c.id, parent_id: null })).parent_id, null);
});
