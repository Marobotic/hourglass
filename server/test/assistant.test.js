// The assistant tab, end to end against the real server and a stand-in opencode.
//
// The stand-in does what opencode does with a message: it reads the account's
// workspace config and calls the Hourglass MCP tools through the URL in it. So
// these tests prove the workspace, the key and the routes - everything but the
// model itself.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TOKEN = "owner-token-for-tests";
const PASSWORD = "oc-password";
let fake, fakeUrl, hg, hgOff, base, baseOff, data, dataOff;

// --- a stand-in for `opencode serve` ------------------------------------------

const sessions = new Map(); // id -> { dir, busy, messages: [] }
let seq = 0;

async function readJson(req) {
  let b = "";
  for await (const c of req) b += c;
  return b ? JSON.parse(b) : {};
}

async function work(s, text) {
  const config = JSON.parse(readFileSync(join(s.dir, "opencode.json"), "utf8"));
  const client = new Client({ name: "fake-opencode", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(config.mcp.hourglass.url)));
  const r = await client.callTool({ name: "add_note", arguments: { title: "From assistant", body: text } });
  await client.close();
  s.messages.push({
    info: { id: `msg_${++seq}`, role: "assistant", time: { created: Date.now() } },
    parts: [
      { type: "tool", tool: "hourglass_add_note", state: { status: r.isError ? "error" : "completed" } },
      { type: "text", text: "Done." },
    ],
  });
  s.busy = false;
}

function fakeOpencode() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
    if (req.headers.authorization !== "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64")) return send(401, { error: "auth" });
    const dir = url.searchParams.get("directory");
    if (!dir) return send(400, { error: "no directory" });
    const p = url.pathname;
    if (p === "/session" && req.method === "POST") {
      const id = `ses_${++seq}`;
      sessions.set(id, { dir, busy: false, messages: [] });
      return send(200, { id });
    }
    if (p === "/session/status") {
      return send(200, Object.fromEntries([...sessions].filter(([, s]) => s.busy).map(([id]) => [id, { type: "busy" }])));
    }
    const m = /^\/session\/([^/]+)(\/.*)?$/.exec(p);
    const s = m && sessions.get(m[1]);
    if (!s) return send(404, { error: "no session" });
    if (s.dir !== dir) return send(403, { error: "wrong workspace" });
    const rest = m[2] || "";
    if (rest === "" && req.method === "GET") return send(200, { id: m[1] });
    if (rest === "" && req.method === "DELETE") { sessions.delete(m[1]); return send(200, true); }
    if (rest === "/message" && req.method === "GET") return send(200, s.messages);
    if (rest === "/abort") { s.busy = false; return send(200, true); }
    if (rest === "/prompt_async" && req.method === "POST") {
      const body = await readJson(req);
      // Built-in tools must be switched off on every message, not only in the config.
      if (body.tools?.bash !== false || body.tools?.edit !== false || body.tools?.webfetch !== false) return send(400, { error: "built-in tools left on" });
      if (body.agent !== "hourglass" || !/It is \w+day \d{4}-\d\d-\d\d/.test(body.system || "")) return send(400, { error: "no agent or context" });
      const text = body.parts[0].text;
      s.messages.push({ info: { id: `msg_${++seq}`, role: "user", time: { created: Date.now() } }, parts: [{ type: "text", text }] });
      s.busy = true;
      setTimeout(() => work(s, text).catch((e) => { s.busy = false; console.error(e); }), 50);
      res.writeHead(204);
      return res.end();
    }
    send(404, { error: "unknown" });
  });
}

// --- the real server -------------------------------------------------------

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function startHourglass(dataDir, extraEnv) {
  const port = await freePort();
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "..", "server.js")], {
      env: { ...process.env, HOURGLASS_DATA: dataDir, HOURGLASS_PORT: String(port), HOURGLASS_HOST: "127.0.0.1", HOURGLASS_TOKEN: TOKEN, MARO_ACCOUNT_URL: "http://127.0.0.1:9", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes(`127.0.0.1:${port}`)) resolveStart({ child, base: `http://127.0.0.1:${port}` });
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
}

before(async () => {
  fake = fakeOpencode();
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  data = mkdtempSync(join(tmpdir(), "hg-assistant-"));
  dataOff = mkdtempSync(join(tmpdir(), "hg-assistant-off-"));
  ({ child: hg, base } = await startHourglass(data, { HOURGLASS_ASSISTANT_URL: fakeUrl, HOURGLASS_ASSISTANT_PASSWORD: PASSWORD, HOURGLASS_ASSISTANT_MODEL: "test/model" }));
  ({ child: hgOff, base: baseOff } = await startHourglass(dataOff, {}));
});

// Wait for the servers to exit before deleting: Windows keeps an open database locked.
const stop = (child) => new Promise((r) => { if (!child || child.exitCode !== null) return r(); child.removeAllListeners("exit"); child.once("exit", r); child.kill(); });

after(async () => {
  await Promise.all([stop(hg), stop(hgOff)]);
  fake?.close();
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
  rmSync(dataOff, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body, at = base) => {
  const r = await fetch(at + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function waitIdle() {
  for(let i = 0; i < 100; i++) {
    const r = await call("GET", "/api/assistant");
    if (!r.body.busy && r.body.messages.some((m) => m.role === "assistant")) return r.body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("assistant never finished");
}

// --- tests ----------------------------------------------------------------------

test("off until configured", async () => {
  const r = await call("GET", "/api/assistant", null, baseOff);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.equal((await call("POST", "/api/assistant/message", { text: "hi" }, baseOff)).status, 503);
});

test("needs an account", async () => {
  const r = await fetch(base + "/api/assistant");
  assert.equal(r.status, 401);
});

test("a message runs, calls the Hourglass tools, and the result lands in the account's data", async () => {
  const empty = await call("GET", "/api/assistant");
  assert.deepEqual(empty.body, { enabled: true, model: "test/model", busy: false, messages: [] });

  const sent = await call("POST", "/api/assistant/message", { text: "Buy eggs and milk" });
  assert.equal(sent.status, 202, JSON.stringify(sent.body));

  const chat = await waitIdle();
  assert.deepEqual(chat.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(chat.messages[0].text, "Buy eggs and milk");
  assert.equal(chat.messages[1].text, "Done.");
  assert.deepEqual(chat.messages[1].tools, [{ tool: "add_note", status: "completed", label: "Wrote a note" }]);

  const notes = await call("POST", "/api/actions/get_notes", { limit: 5 });
  assert.ok(notes.body.some((n) => n.title === "From assistant" && n.body === "Buy eggs and milk"), JSON.stringify(notes.body));
});

test("the workspace allows only the Hourglass tools", async () => {
  const { readdirSync } = await import("node:fs");
  const root = join(data, "assistant");
  const [dir] = readdirSync(root);
  const config = JSON.parse(readFileSync(join(root, dir, "opencode.json"), "utf8"));
  assert.equal(config.tools["*"], false);
  for (const t of ["bash", "edit", "write", "read", "webfetch", "task"]) assert.equal(config.tools[t], false, t);
  assert.equal(config.tools["hourglass_*"], true);
  assert.deepEqual(config.permission, { edit: "deny", bash: "deny", webfetch: "deny" });
  assert.equal(config.agent.hourglass.mode, "primary");
  assert.equal(config.agent.build.disable, true);
  assert.match(config.agent.hourglass.prompt, /You can only act through the hourglass tools/);
  assert.match(config.agent.hourglass.prompt, /whats_now/); // the skill reference is included
  assert.match(config.mcp.hourglass.url, /\/mcp\/hg_as_[A-Za-z0-9_-]{20,}$/);
});

test("the assistant keeps working after the user's AI link is deleted", async () => {
  const link = await call("POST", "/api/ai");
  assert.match(link.body.key, /^hg_/);
  assert.equal((await call("DELETE", "/api/ai")).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "Second note" })).status, 202);
  const chat = await waitIdle();
  assert.equal(chat.messages.at(-1).tools[0].status, "completed");
});

test("one message at a time, and empty or huge messages are refused", async () => {
  assert.equal((await call("POST", "/api/assistant/message", { text: "   " })).status, 400);
  assert.equal((await call("POST", "/api/assistant/message", { text: "x".repeat(5000) })).status, 413);
  assert.equal((await call("POST", "/api/assistant/message", { text: "first" })).status, 202);
  assert.equal((await call("POST", "/api/assistant/message", { text: "second" })).status, 409);
  await waitIdle();
});

test("a new chat starts empty", async () => {
  assert.equal((await call("POST", "/api/assistant/new")).status, 200);
  const r = await call("GET", "/api/assistant");
  assert.deepEqual(r.body.messages, []);
});
