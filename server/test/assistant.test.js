// The assistant tab, end to end against the real server and a stand-in for
// `opencode run` (fake-opencode.mjs), which does what opencode does with a
// message: read the account's config and call the Hourglass MCP tools.
// These tests prove the account folder, the key, the chat and the routes -
// everything but the model itself and the systemd sandbox.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "owner-token-for-tests";
const FAKE = join(import.meta.dirname, "fake-opencode.mjs");
let hg, hgOff, base, baseOff, data, dataOff, accounts;

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function startHourglass(dataDir, extraEnv = {}) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HOURGLASS_DATA: dataDir, HOURGLASS_PORT: String(port), HOURGLASS_HOST: "127.0.0.1", HOURGLASS_TOKEN: TOKEN, MARO_ACCOUNT_URL: "http://127.0.0.1:9", HOURGLASS_URL: url };
  delete env.HOURGLASS_ASSISTANT;
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "..", "server.js")], { env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes(`127.0.0.1:${port}`)) resolveStart({ child, base: url });
    });
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
}

before(async () => {
  data = mkdtempSync(join(tmpdir(), "hg-assistant-"));
  dataOff = mkdtempSync(join(tmpdir(), "hg-assistant-off-"));
  accounts = join(data, "assistant-accounts");
  ({ child: hg, base } = await startHourglass(data, {
    HOURGLASS_ASSISTANT: "on",
    HOURGLASS_ASSISTANT_RUNNER: "direct",
    HOURGLASS_ASSISTANT_BIN: FAKE,
    HOURGLASS_ASSISTANT_MODELS: "fake/down,fake/good",
    HOURGLASS_ASSISTANT_VISION_MODELS: "fake/vision",
    HOURGLASS_ASSISTANT_DIR: accounts,
  }));
  ({ child: hgOff, base: baseOff } = await startHourglass(dataOff));
});

// Wait for the servers to exit before deleting: Windows keeps an open database locked.
const stop = (child) => new Promise((r) => { if (!child || child.exitCode !== null) return r(); child.removeAllListeners("exit"); child.once("exit", r); child.kill(); });

after(async () => {
  await Promise.all([stop(hg), stop(hgOff)]);
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
  rmSync(dataOff, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body, at = base) => {
  const r = await fetch(at + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function waitIdle() {
  for (let i = 0; i < 200; i++) {
    const r = await call("GET", "/api/assistant");
    if (!r.body.busy) return r.body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("assistant never finished");
}

const accountDir = () => join(accounts, readdirSync(accounts)[0]);
const calls = () => readFileSync(join(accountDir(), "work", "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// --- tests ----------------------------------------------------------------------

test("off until configured", async () => {
  const r = await call("GET", "/api/assistant", null, baseOff);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.equal((await call("POST", "/api/assistant/message", { text: "hi" }, baseOff)).status, 503);
});

test("needs an account", async () => {
  assert.equal((await fetch(base + "/api/assistant")).status, 401);
});

test("a message runs opencode, which works on the account's data through the Hourglass tools", async () => {
  const empty = await call("GET", "/api/assistant");
  assert.deepEqual(empty.body, { enabled: true, model: "fake/down", busy: false, messages: [] });

  assert.equal((await call("POST", "/api/assistant/message", { text: "Buy eggs and milk" })).status, 202);
  const chat = await waitIdle();
  assert.deepEqual(chat.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(chat.messages[0].text, "Buy eggs and milk");
  // The answer is the last step's text, not what was said before the tool call.
  assert.equal(chat.messages[1].text, "Done.");
  assert.deepEqual(chat.messages[1].tools, [{ tool: "add_note", status: "completed", label: "Wrote a note" }]);
  assert.equal(chat.messages[1].error, null);

  const notes = await call("POST", "/api/actions/get_notes", { limit: 5 });
  assert.ok(notes.body.some((n) => n.title === "From assistant" && n.body === "Buy eggs and milk"), JSON.stringify(notes.body));

  // The first model was down, so the next one was used. The first message of a
  // conversation carries the full instructions and the time.
  const c = calls();
  assert.deepEqual(c.map((x) => x.model), ["fake/down", "fake/good"]);
  assert.equal(c[1].session, null);
  assert.match(c[1].prompt, /You are the assistant built into Hourglass/);
  assert.match(c[1].prompt, /hourglass_search/);
  assert.match(c[1].prompt, /It is \w+day \d{4}-\d\d-\d\d/);
  // The app guide and the account snapshot travel with it.
  assert.match(c[1].prompt, /# Hourglass, the app/);
  assert.match(c[1].prompt, /On now and next:/);
  assert.equal(c[1].home, join(accountDir(), "home"));
});

test("the account folder's config is stock opencode plus the Hourglass MCP server", async () => {
  const config = JSON.parse(readFileSync(join(accountDir(), "work", "opencode.json"), "utf8"));
  // Anything else (tools, permissions, agents) and the free models refuse to answer.
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "mcp"]);
  assert.deepEqual(Object.keys(config.mcp), ["hourglass"]);
  assert.match(config.mcp.hourglass.url, /\/mcp\/hg_as_[A-Za-z0-9_-]{20,}$/);
});

test("the next message continues the same opencode session, with a short reminder", async () => {
  assert.equal((await call("POST", "/api/assistant/message", { text: "Second note" })).status, 202);
  const chat = await waitIdle();
  assert.equal(chat.messages.length, 4);
  const last = calls().at(-1);
  assert.equal(last.session, "ses_fake1");
  assert.doesNotMatch(last.prompt, /You are the assistant built into Hourglass/);
  assert.match(last.prompt, /You are the Hourglass assistant/);
});

test("the assistant keeps working after the user's AI link is deleted", async () => {
  const link = await call("POST", "/api/ai");
  assert.match(link.body.key, /^hg_/);
  assert.equal((await call("DELETE", "/api/ai")).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "Third note" })).status, 202);
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

test("a new chat starts empty, and its first message starts a new session", async () => {
  assert.equal((await call("POST", "/api/assistant/new")).status, 200);
  assert.deepEqual((await call("GET", "/api/assistant")).body.messages, []);
  assert.equal((await call("POST", "/api/assistant/message", { text: "Fresh start" })).status, 202);
  await waitIdle();
  const last = calls().at(-1);
  assert.equal(last.session, null);
  assert.match(last.prompt, /You are the assistant built into Hourglass/);
});

test("common requests are answered at once, without a model, and the model hears about them", async () => {
  const before = calls().length;
  const r = await call("POST", "/api/assistant/message", { text: "set a 25 minute timer" });
  assert.equal(r.status, 200);
  assert.equal(r.body.quick, true);
  const chat = (await call("GET", "/api/assistant")).body;
  assert.equal(chat.busy, false);
  const reply = chat.messages.at(-1);
  assert.equal(reply.quick, true);
  assert.match(reply.text, /Timer started for 25 minutes/);
  assert.deepEqual(reply.tools.map((t) => t.label), ["Started a timer"]);
  assert.equal(calls().length, before, "no opencode run");
  const timers = await call("POST", "/api/actions/list_timers", {});
  assert.ok(timers.body.some((t) => t.duration_s === 1500));
  // The next model run is told what the app did on its own.
  assert.equal((await call("POST", "/api/assistant/message", { text: "Note it down" })).status, 202);
  await waitIdle();
  assert.match(calls().at(-1).prompt, /Earlier in this chat the app answered these itself:\nUser: set a 25 minute timer/);
});

test("attachments: uploaded to the Drive's Assistant folder, staged for the model, pictures on a model that sees", async () => {
  const folder = await call("GET", "/api/assistant/folder");
  assert.equal(folder.body.name, "Assistant");
  // The same folder every time.
  assert.equal((await call("GET", "/api/assistant/folder")).body.folder_id, folder.body.folder_id);
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const up = await fetch(`${base}/api/files/upload?name=${encodeURIComponent("receipt.png")}&folder=${folder.body.folder_id}`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: png,
  });
  const file = await up.json();
  assert.equal(up.status, 201, JSON.stringify(file));
  assert.equal((await call("POST", "/api/assistant/message", { text: "What is this?", files: [file.id, "not-a-file"] })).status, 202);
  const chat = await waitIdle();
  const mine = chat.messages.at(-2);
  assert.deepEqual(mine.files.map((f) => f.name), ["receipt.png"]);
  const last = calls().at(-1);
  assert.equal(last.model, "fake/vision");
  const f = last.args.indexOf("-f");
  assert.ok(f > 0, "picture attached with -f");
  assert.match(last.args[f + 1], /^uploads\/[0-9a-f]{8}-receipt\.png$/);
  assert.deepEqual(readFileSync(join(accountDir(), "work", last.args[f + 1])), png);
  assert.ok(last.prompt.includes(`receipt.png (image/png, file ${file.id})`), last.prompt);
  // A file alone, with no words, is still a message.
  assert.equal((await call("POST", "/api/assistant/message", { files: [file.id] })).status, 202);
  await waitIdle();
});
