// The assistant API additions, end to end against the real server, a stand-in
// for `opencode run` and a stand-in Anthropic API: live SSE events, effort,
// queueing and steering, retry/edit/undo, plan mode, tool detail and usage.
// Fake engines only: no real key or sign-in anywhere.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "owner-token-for-tests";
const KEY = "sk-test-good";
const FAKE = join(import.meta.dirname, "fake-opencode.mjs");
let hg, fake, base, data, accounts, fakeUrl;
const seen = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sendSse(res, events, delay = 0) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return (async () => {
    for (const event of events) {
      if (res.destroyed) return;
      res.write(`${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`);
      if (delay) await sleep(delay);
    }
    if (!res.destroyed) res.end();
  })();
}

function startFake() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const json = body ? JSON.parse(body) : null;
      seen.push({ path: req.url, headers: req.headers, body: json });
      const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
      const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer /, "");
      if (key !== KEY) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      if (req.url.startsWith("/v1/models")) return send(200, { data: [
        { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", context_window: 200000, pricing: { input: 0.000001, output: 0.000005 } },
        { id: "claude-slow-stream", display_name: "Claude Slow", context_window: 120000 },
        { id: "claude-steer", display_name: "Claude Steer", context_window: 100000 },
      ], has_more: false });
      if (req.url.startsWith("/v1/messages")) {
        const done = json.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
        const start = { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: json.model, content: [], usage: { input_tokens: 25, cache_read_input_tokens: 5 } } };
        if (JSON.stringify(json.messages.at(-1)?.content || "").includes("QUOTA_TEST")) {
          // 402 is not retried by the SDK, so the test stays quick; the reset header carries the time.
          return send(402, { type: "error", error: { type: "insufficient_quota", message: "provider private limit" } }, { "anthropic-ratelimit-requests-reset": new Date(Date.now() + 60_000).toISOString() });
        }
        if (json.model === "claude-steer") {
          if (!done) {
            await sleep(500);
            return sendSse(res, [start,
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking." } },
              { type: "content_block_stop", index: 0 },
              { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_steer", name: "get_settings", input: {} } },
              { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } }, { type: "message_stop" }]);
          }
          return sendSse(res, [start,
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done after steer." } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }, { type: "message_stop" }]);
        }
        if (json.model === "claude-slow-stream") {
          return sendSse(res, [start,
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Streamed " } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answer." } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } }, { type: "message_stop" }], 60);
        }
        return sendSse(res, [start,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude." } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } }, { type: "message_stop" }]);
      }
      send(404, { error: { message: "not here" } });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

before(async () => {
  fake = await startFake();
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  data = mkdtempSync(join(tmpdir(), "hg-assistant-api-"));
  accounts = join(data, "assistant-accounts");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, HOURGLASS_DATA: data, HOURGLASS_PORT: String(port), HOURGLASS_HOST: "127.0.0.1", HOURGLASS_TOKEN: TOKEN,
    MARO_ACCOUNT_URL: "http://127.0.0.1:9", HOURGLASS_URL: url, HOURGLASS_ASSISTANT: "on", HOURGLASS_ASSISTANT_RUNNER: "direct",
    HOURGLASS_ASSISTANT_BIN: FAKE, HOURGLASS_ASSISTANT_MODELS: "fake/good", HOURGLASS_ASSISTANT_DIR: accounts,
    ANTHROPIC_BASE_URL: fakeUrl, HOURGLASS_TEST_HTTP_API: "1",
  };
  base = url;
  await new Promise((resolve, reject) => {
    hg = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    hg.stdout.on("data", (d) => { out += d; if (out.includes(` on http://127.0.0.1:${port}`)) resolve(); });
    hg.stderr.on("data", (d) => (out += d));
    hg.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
});

const streams = [];
after(async () => {
  for (const close of streams) { try { close(); } catch {} }
  await new Promise((r) => { if (hg.exitCode !== null) return r(); hg.removeAllListeners("exit"); hg.once("exit", r); hg.kill(); });
  fake.close();
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function waitIdle() {
  for (let i = 0; i < 1200; i++) {
    const r = await call("GET", "/api/assistant");
    if (!r.body.busy && !r.body.queued) return r.body;
    await sleep(50);
  }
  throw new Error("assistant never finished");
}

const accountDir = () => join(accounts, readdirSync(accounts).find((name) => !name.startsWith(".")));
const calls = () => readFileSync(join(accountDir(), "work", "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** Opens the SSE endpoint and collects parsed events. */
async function openStream() {
  const controller = new AbortController();
  const response = await fetch(base + "/api/assistant/stream", { headers: { authorization: `Bearer ${TOKEN}` }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const packet = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let event = "message";
          let data = "";
          for (const line of packet.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue; // heartbeat
          try { events.push({ event, data: JSON.parse(data) }); } catch {}
        }
      }
    } catch {}
  })();
  const close = () => controller.abort();
  streams.push(close);
  return { events, close };
}

async function waitForEvent(stream, name, predicate = () => true, timeoutMs = 60000) {
  const began = Date.now();
  while (Date.now() - began < timeoutMs) {
    const hit = stream.events.find((e) => e.event === name && predicate(e.data));
    if (hit) return hit.data;
    await sleep(25);
  }
  throw new Error(`no ${name} event: ${JSON.stringify(stream.events).slice(0, 800)}`);
}

// --- live streaming, tool detail, usage -------------------------------------------

test("SSE streams text deltas, tool phases with trimmed input/output, usage and state", async () => {
  const stream = await openStream();
  const ready = await waitForEvent(stream, "ready");
  assert.equal(ready.enabled, true);
  assert.equal(ready.state, "idle");

  assert.equal((await call("POST", "/api/assistant/message", { text: "STREAM_TEST note please" })).status, 202);
  await waitForEvent(stream, "message_end");
  await waitForEvent(stream, "state", (d) => d.state === "idle");

  const started = stream.events.find((e) => e.event === "message_start").data;
  assert.equal(started.engine, "free");
  const texts = stream.events.filter((e) => e.event === "text").map((e) => e.data);
  assert.ok(texts.every((t) => t.message_id === started.message_id));
  let rebuilt = "";
  for (const t of texts) rebuilt = t.replace ? t.text : rebuilt + t.delta;
  assert.equal(rebuilt, texts.at(-1).text);
  assert.match(texts.at(-1).text, /Done\./);

  const toolStart = stream.events.find((e) => e.event === "tool_start").data;
  assert.equal(toolStart.tool, "add_note");
  assert.equal(toolStart.status, "running");
  assert.match(toolStart.input, /From assistant/);
  const toolEnd = stream.events.find((e) => e.event === "tool_end").data;
  assert.equal(toolEnd.status, "completed");
  assert.equal(toolEnd.label, "Wrote a note");
  assert.ok(toolEnd.output, JSON.stringify(toolEnd));
  assert.ok(Number.isFinite(toolEnd.duration_ms));
  assert.ok(stream.events.some((e) => e.event === "state" && e.data.state === "busy"));
  const usage = stream.events.find((e) => e.event === "usage").data;
  assert.equal(usage.input_tokens, 120);
  assert.equal(usage.output_tokens, 18);
  const end = stream.events.find((e) => e.event === "message_end").data;
  assert.equal(end.error, null);
  stream.close();
});

test("a message sent during a run waits its turn and then runs", async () => {
  assert.equal((await call("POST", "/api/assistant/message", { text: "SLOW_TEST first" })).status, 202);
  const second = await call("POST", "/api/assistant/message", { text: "second while busy" });
  assert.equal(second.status, 202);
  assert.equal(second.body.queued, true);
  const done = await waitIdle();
  const users = done.messages.filter((m) => m.role === "user").map((m) => m.text);
  assert.ok(users.includes("SLOW_TEST first"));
  assert.ok(users.includes("second while busy"));
  assert.equal(done.messages.at(-1).role, "assistant");
});

test("Anthropic streams through SSE and retry/edit/undo work", async () => {
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-slow-stream", key: KEY })).status, 200);
  const stream = await openStream();
  assert.equal((await call("POST", "/api/assistant/message", { text: "Stream on Claude" })).status, 202);
  const deltas = [];
  const began = Date.now();
  while (Date.now() - began < 8000) {
    for (const e of stream.events.filter((x) => x.event === "text")) deltas.push(e.data);
    if (stream.events.some((e) => e.event === "message_end")) break;
    await sleep(25);
  }
  const end = await waitForEvent(stream, "message_end");
  assert.equal(end.text, "Streamed answer.");
  const usage = await waitForEvent(stream, "usage");
  assert.equal(usage.input_tokens, 25);
  assert.equal(usage.output_tokens, 6);
  assert.equal(usage.context_window, 120000);
  stream.close();

  // Retry replays the last user message.
  const before = seen.length;
  const retried = await call("POST", "/api/assistant/retry", {});
  assert.equal(retried.status, 202);
  assert.equal(retried.body.retried, "Stream on Claude");
  const replay = await waitIdle();
  assert.equal(replay.messages.at(-1).text, "Streamed answer.");
  assert.ok(seen.length > before, "the model ran again");

  // Edit truncates everything after the edited message.
  await call("POST", "/api/assistant/message", { text: "ORIGINAL WORDING" });
  const afterFirst = await waitIdle();
  const target = afterFirst.messages.find((m) => m.text === "ORIGINAL WORDING");
  assert.equal((await call("POST", "/api/assistant/edit", { message_id: target.id, text: "EDITED WORDING" })).status, 202);
  const edited = await waitIdle();
  assert.ok(edited.messages.some((m) => m.text === "EDITED WORDING"));
  assert.equal(edited.messages.some((m) => m.text === "ORIGINAL WORDING"), false);
});

test("plan mode only reads: the server refuses writing tools", async () => {
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "free", model: "" })).status, 200);
  assert.equal((await call("POST", "/api/assistant/mode", { mode: "plan" })).body.mode, "plan");
  const notesBefore = (await call("POST", "/api/actions/get_notes", { limit: 100 })).body.length;

  assert.equal((await call("POST", "/api/assistant/message", { text: "CHANGE_MCP_TEST" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error, null);
  assert.equal((reply.pending_actions || []).length, 0, "plan mode never proposes a change");
  const notesAfter = (await call("POST", "/api/actions/get_notes", { limit: 100 })).body.length;
  assert.equal(notesAfter, notesBefore, "no note was written");

  // Reading is still allowed.
  assert.equal((await call("POST", "/api/assistant/message", { text: "READ_MCP_TEST" })).status, 202);
  const read = (await waitIdle()).messages.at(-1);
  assert.equal(read.error, null);

  assert.equal((await call("POST", "/api/assistant/mode", { mode: "auto" })).body.mode, "auto");
});

test("undo restores the previous Drive version of the file the assistant changed", async () => {
  const up = await fetch(`${base}/api/files/upload?name=undo.txt`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "before\n" });
  const file = await up.json();
  assert.equal(up.status, 201, JSON.stringify(file));
  assert.equal((await call("POST", "/api/assistant/mode", { mode: "dangerous" })).body.mode, "dangerous");
  assert.equal((await call("POST", "/api/assistant/message", { text: "WRITE_FILE_TEST" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  const card = reply.cards.find((c) => c.kind === "file" && c.file_id === file.id);
  assert.ok(card, JSON.stringify(reply.cards));
  const changed = await fetch(`${base}/api/files/${file.id}/raw`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(await changed.text(), "after\n");

  const undone = await call("POST", "/api/assistant/undo", {});
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.action, "restored");
  assert.equal(undone.body.file_id, file.id);
  const restored = await fetch(`${base}/api/files/${file.id}/raw`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(await restored.text(), "before\n");
  const again = await call("POST", "/api/assistant/undo", {});
  assert.equal(again.status, 404, "nothing is undone twice");

  await call("POST", "/api/assistant/mode", { mode: "auto" });
});

// --- steering, quota and usage ------------------------------------------------------

test("a steer reaches a direct engine between its steps", async () => {
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-steer", key: KEY })).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "First question" })).status, 202);
  // Wait until the model call is in flight (the fake holds it for 500 ms).
  for (let i = 0; i < 100; i++) {
    const hit = seen.filter((r) => r.path.startsWith("/v1/messages")).at(-1);
    const last = JSON.stringify(hit?.body?.messages || []);
    if (last.includes("First question")) break;
    await sleep(10);
  }
  const steer = await call("POST", "/api/assistant/message", { text: "STEER_TEXT use the blue one", steer: true });
  assert.equal(steer.status, 202, JSON.stringify(steer.body));
  assert.equal(steer.body.steer, true);
  const done = await waitIdle();
  const answer = [...done.messages].reverse().find((m) => m.role === "assistant");
  assert.equal(answer.text, "Checking.\n\nDone after steer.");
  assert.ok(done.messages.some((m) => m.steer && m.text.includes("STEER_TEXT")), "the steer is in the transcript");
  const secondRequest = seen.filter((r) => r.path.startsWith("/v1/messages")).at(-1);
  assert.match(JSON.stringify(secondRequest.body.messages), /STEER_TEXT/);
});

test("a provider limit becomes a quota state with its reset time, cleared on recovery", async () => {
  const stream = await openStream();
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-haiku-5-5", key: KEY })).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "QUOTA_TEST" })).status, 202);
  const quotaEvent = await waitForEvent(stream, "quota", (d) => d.state === "quota", 20000);
  assert.ok(["quota", "rate_limit"].includes(quotaEvent.kind));
  assert.ok(quotaEvent.resets_at > Date.now(), JSON.stringify(quotaEvent));
  const live = (await call("GET", "/api/assistant")).body;
  assert.equal(live.quota.kind, quotaEvent.kind);
  assert.equal(live.messages.at(-1).error_kind, quotaEvent.kind);
  assert.ok(live.messages.at(-1).error_resets_at > Date.now());

  // A good run clears it.
  assert.equal((await call("POST", "/api/assistant/message", { text: "Are you back?" })).status, 202);
  await waitIdle();
  await waitForEvent(stream, "quota", (d) => d.state === "ok");
  assert.equal((await call("GET", "/api/assistant")).body.quota, null);
  stream.close();
});

test("usage aggregates per day and per engine, with the context meter and DeepSeek state", async () => {
  const usage = await call("GET", "/api/assistant/usage?days=7");
  assert.equal(usage.status, 200);
  assert.equal(usage.body.days.length, 7);
  assert.ok(usage.body.totals.runs > 0);
  assert.ok(usage.body.totals.tokens > 0);
  assert.ok(usage.body.engines.some((e) => e.engine === "free"));
  assert.ok(usage.body.engines.some((e) => e.engine === "anthropic"));
  assert.equal(usage.body.today.date, new Date().toISOString().slice(0, 10));
  assert.equal(usage.body.limits.messages_per_hour, 60);
  assert.equal(usage.body.limits.max_running, 3);
  assert.ok(usage.body.context.window >= 100000);
  assert.ok(usage.body.context.input_tokens > 0);
  assert.equal(typeof usage.body.deepseek.peak, "boolean");
  assert.match(usage.body.deepseek.line, /Peak price|Off-peak/);
  assert.equal(usage.body.quota, null);
  assert.ok(Array.isArray(usage.body.effort_options));
});

test("effort is returned with the models and kept per engine and model", async () => {
  const settings = await call("GET", "/api/assistant/settings");
  assert.deepEqual(settings.body.claude_models.find((m) => m.id === "claude-haiku-5-5").efforts, ["low", "medium", "high"]);
  assert.ok(settings.body.free_models.every((m) => Array.isArray(m.efforts)));
  const saved = await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-haiku-5-5", effort: "low" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.effort, "low");
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "anthropic", effort: "extreme" })).status, 400);
});
