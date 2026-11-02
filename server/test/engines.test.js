// The assistant's direct engines (engines.js) against stand-ins for the Claude
// API and an OpenAI-compatible API: the key is checked and stored without
// being shown again, the model's tool calls run on the account's data, and
// each action comes back as a card.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "owner-token-for-tests";
const GOOD_KEY = "sk-test-good";
let hg, base, data, fake, fakeUrl;
const seen = []; // requests the fake APIs got
let openaiStreamClosed = false;
let anthropicStreamClosed = false;

function sendSse(res, events, delay = 0) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return (async () => {
    for (const event of events) {
      if (res.destroyed) return;
      res.write(`${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (!res.destroyed) res.end("data: [DONE]\n\n");
  })();
}

// One fake for both APIs. The model asks for an alarm, then says it is done.
function startFake() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const json = body ? JSON.parse(body) : null;
      seen.push({ path: req.url, headers: req.headers, body: json });
      const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
      const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer /, "");
      if (key !== GOOD_KEY) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      if (req.url.startsWith("/v1/models")) return send(200, { data: [
        { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z", context_window: 200000, pricing: { input: 0.000005, output: 0.000025 } },
        { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-01-01T00:00:00Z", context_window: 200000, pricing: { input: 0.000001, output: 0.000005 } },
        { type: "model", id: "claude-live-custom", display_name: "Claude Live Custom", created_at: "2026-01-01T00:00:00Z" },
        { type: "model", id: "claude-stream-abort", display_name: "Claude Stream Abort", created_at: "2026-01-01T00:00:00Z" },
      ], has_more: false });
      if (req.url.startsWith("/v1/messages")) {
        if (json.model === "claude-stream-abort") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "abort", type: "message", role: "assistant", model: json.model, content: [], usage: { input_tokens: 2 } } })}\n\n`);
          res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } })}\n\n`);
          res.on("close", () => { anthropicStreamClosed = true; });
          return;
        }
        const done = json.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
        const id = done ? "msg_2" : "msg_1";
        const start = { type: "message_start", message: { id, type: "message", role: "assistant", model: json.model, content: [], usage: { input_tokens: 10, cache_read_input_tokens: 2 } } };
        if (!done) return sendSse(res, [start,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I'll set that." } },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_1", name: "set_alarm", input: {} } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"label":"Gym",' } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"time":"07:30","days":["Mon","Wed"]}' } },
          { type: "content_block_stop", index: 1 },
          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } }, { type: "message_stop" }]);
        return sendSse(res, [start,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Do" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ne." } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }, { type: "message_stop" }], 5);
      }
      if (req.url === "/openai/models") return send(200, { data: ["gpt-test", "gpt-other", "gpt-rate", "gpt-alt", "gpt-partial", "zz-stream", "zz-abort"].map((id) => ({ id, name: `Display ${id}`, context_length: ["gpt-test", "zz-stream", "zz-abort"].includes(id) ? 128000 : undefined, pricing: ["gpt-test", "zz-stream", "zz-abort"].includes(id) ? { prompt: "0.000002", completion: "0.000008" } : undefined })) });
      if (req.url === "/deepseek/models") return send(200, { data: [
        { id: "deepseek-flash", name: "DeepSeek Flash", context_length: 1000000 },
        { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", context_length: 1000000 },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
      ] });
      if (req.url === "/openai/chat/completions") {
        const done = json.messages.some((m) => m.role === "tool");
        if (json.model === "gpt-rate") return send(429, { error: { code: "rate_limit_exceeded", message: "provider private rate limit detail" } }, { "retry-after": "3" });
        if (json.model === "gpt-partial" && done) return send(429, { error: { code: "rate_limit_exceeded", message: "provider private late limit detail" } }, { "retry-after": "3" });
        if (json.model === "zz-abort") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`);
          res.on("close", () => { openaiStreamClosed = true; });
          return;
        }
        if (json.model === "zz-stream") return sendSse(res, [
          { choices: [{ delta: { content: "A streamed " } }] },
          { choices: [{ delta: { content: "reply." } }] },
          { choices: [], usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 6 } } },
        ], 100);
        if (!done) return sendSse(res, [
          { choices: [{ delta: { content: "I'll set that." } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "start_timer", arguments: '{"minutes":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '25,"label":"Focus"}' } }] } }] },
          { choices: [], usage: { prompt_tokens: 16, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 4 } } },
        ]);
        return sendSse(res, [
          { choices: [{ delta: { content: "Timer" } }] },
          { choices: [{ delta: { content: "'s on." } }] },
          { choices: [], usage: { prompt_tokens: 30, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 5 } } },
        ]);
      }
      if (req.url === "/deepseek/chat/completions") {
        const prompt = JSON.stringify(json.messages.at(-1)?.content || "");
        if (prompt.includes("DEEPSEEK_402_TEST")) return send(402, { error: { code: "insufficient_balance", message: "Insufficient Balance" } });
        if (prompt.includes("DEEPSEEK_429_TEST")) return send(429, { error: { code: "rate_limit_exceeded", message: "Too Many Requests" } }, { "retry-after": "1" });
        return sendSse(res, [
          { choices: [{ delta: { content: "DeepSeek " } }] },
          { choices: [{ delta: { content: "streamed." } }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 8 } },
        ]);
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
  data = mkdtempSync(join(tmpdir(), "hg-engines-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, HOURGLASS_DATA: data, HOURGLASS_PORT: String(port), HOURGLASS_HOST: "127.0.0.1", HOURGLASS_TOKEN: TOKEN,
    MARO_ACCOUNT_URL: "http://127.0.0.1:9", HOURGLASS_URL: url, HOURGLASS_ASSISTANT: "on", HOURGLASS_ASSISTANT_RUNNER: "direct",
    HOURGLASS_ASSISTANT_BIN: join(import.meta.dirname, "fake-opencode.mjs"), HOURGLASS_ASSISTANT_DIR: join(data, "assistant-accounts"),
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

after(async () => {
  await new Promise((r) => { if (hg.exitCode !== null) return r(); hg.removeAllListeners("exit"); hg.once("exit", r); hg.kill(); });
  fake.close();
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
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

test("settings: free by default, a bad key is refused, a good one is kept but never shown", async () => {
  const s = await call("GET", "/api/assistant/settings");
  assert.equal(s.body.engine, "free");
  assert.ok(s.body.engines.some((e) => e.id === "anthropic"));
  assert.ok(s.body.claude_models.length >= 3);
  assert.equal(s.body.claude_model_source, "fallback");
  const bad = await call("POST", "/api/assistant/settings", { engine: "anthropic", key: "sk-wrong" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /rejected.*Assistant settings/);
  const ok = await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-haiku-5-5", key: GOOD_KEY });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.has_key, { anthropic: true });
  const again = await call("GET", "/api/assistant/settings");
  assert.equal(JSON.stringify(again.body).includes(GOOD_KEY), false, "the key never comes back");
  const file = readdirSync(data, { recursive: true }).find((f) => String(f).endsWith("assistant_settings.json"));
  const stored = readFileSync(join(data, String(file)), "utf8");
  assert.equal(stored.includes(GOOD_KEY), false, "the key is stored encrypted");
  const live = await call("GET", "/api/assistant/settings");
  assert.equal(live.body.claude_model_source, "live");
  assert.equal(live.body.claude_models.find((m) => m.id === "claude-opus-5-5").name, "Claude Opus 5.5");
  assert.equal(live.body.claude_models.find((m) => m.id === "claude-opus-5-5").context_window, 200000);
  assert.deepEqual(live.body.claude_models.find((m) => m.id === "claude-opus-5-5").pricing, { input: 0.000005, output: 0.000025 });
  const unknownMeta = live.body.claude_models.find((m) => m.id === "claude-live-custom");
  assert.equal(unknownMeta.context_window, null);
  assert.equal(unknownMeta.pricing, null);
});

test("Claude with a key: the tool call sets the alarm, and the reply has an alarm card", async () => {
  assert.equal((await call("POST", "/api/assistant/message", { text: "help me plan my gym mornings" })).status, 202);
  const done = await waitIdle();
  const reply = done.messages.at(-1);
  assert.equal(reply.error, null);
  assert.equal(reply.text, "I'll set that.\n\nDone.");
  assert.equal(reply.model, "claude-haiku-5-5");
  assert.deepEqual(reply.tools.map((x) => [x.tool, x.status]), [["set_alarm", "completed"]]);
  assert.equal(reply.cards.length, 1);
  assert.equal(reply.cards[0].kind, "alarm");
  assert.equal(reply.cards[0].label, "Gym");
  assert.equal(reply.cards[0].when, "Mon, Wed");
  assert.equal(reply.cards[0].time, "7:30 AM");
  assert.equal(reply.usage.input_tokens, 20);
  assert.equal(reply.usage.output_tokens, 8);
  assert.equal(reply.usage.cache_read_input_tokens, 4);
  assert.ok(reply.usage.cost > 0);
  assert.equal(reply.usage.context_window, 200000);
  // The request: low effort, the system prompt cached, every Hourglass tool offered.
  const req = seen.filter((r) => r.path.startsWith("/v1/messages"))[0].body;
  assert.equal(req.model, "claude-haiku-5-5");
  assert.equal(req.output_config.effort, "low");
  assert.ok(req.tools.some((t) => t.name === "add_birthday"));
  assert.match(req.system[0].text, /Never ask for confirmation/);
});

test("Claude settings accept a model id from the live API list", async () => {
  const set = await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-live-custom" });
  assert.equal(set.status, 200);
});

test("another API with a key: models are listed, and its tool calls run too", async () => {
  const set = await call("POST", "/api/assistant/settings", { engine: "openai", base_url: `${fakeUrl}/openai`, key: GOOD_KEY, model: "gpt-test" });
  assert.equal(set.status, 200);
  const models = await call("GET", `/api/assistant/models?base_url=${encodeURIComponent(fakeUrl + "/openai")}`);
  assert.deepEqual(models.body.models.map((m) => m.id), ["gpt-alt", "gpt-other", "gpt-partial", "gpt-rate", "gpt-test", "zz-abort", "zz-stream"]);
  const rich = models.body.models.find((m) => m.id === "gpt-test");
  assert.equal(rich.name, "Display gpt-test");
  assert.equal(rich.context_window, 128000);
  assert.deepEqual(rich.pricing, { input: 0.000002, output: 0.000008 });
  assert.equal(models.body.models.find((m) => m.id === "gpt-other").context_window, null);
  assert.equal(models.body.models.find((m) => m.id === "gpt-other").pricing, null);
  assert.equal((await call("POST", "/api/assistant/message", { text: "focus timer please, 25 min" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error, null);
  assert.equal(reply.text, "I'll set that.\n\nTimer's on.");
  assert.equal(reply.cards[0].kind, "timer");
  assert.equal(reply.cards[0].label, "Focus");
  assert.equal(reply.cards[0].duration_s, 1500);
  assert.equal(reply.usage.input_tokens, 46);
  assert.equal(reply.usage.output_tokens, 13);
  assert.equal(reply.usage.cache_read_input_tokens, 9);
  assert.ok(reply.usage.cost > 0);
  assert.equal(reply.usage.context_window, 128000);
  // The earlier exchange went along as history.
  const req = seen.filter((r) => r.path === "/openai/chat/completions")[0].body;
  assert.ok(req.messages.some((m) => m.role === "assistant" && m.content === "I'll set that.\n\nDone."));
});

test("OpenAI-compatible text streams into the polled message with usage metadata", async () => {
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "openai", base_url: `${fakeUrl}/openai`, model: "zz-stream" })).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "Stream a reply" })).status, 202);
  let partial = false;
  for (let i = 0; i < 30; i++) {
    const live = await call("GET", "/api/assistant");
    partial ||= live.body.messages.at(-1)?.text === "A streamed ";
    if (!live.body.busy) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(partial, true);
  assert.equal(reply.text, "A streamed reply.");
  assert.equal(reply.usage.input_tokens, 20);
  assert.equal(reply.usage.output_tokens, 4);
  assert.equal(reply.usage.cache_read_input_tokens, 6);
  assert.equal(reply.usage.context_window, 128000);
});

test("stopping a streamed OpenAI-compatible reply aborts its fetch", async () => {
  openaiStreamClosed = false;
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "openai", base_url: `${fakeUrl}/openai`, model: "zz-abort" })).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "Stop this stream" })).status, 202);
  for (let i = 0; i < 30; i++) {
    const live = await call("GET", "/api/assistant");
    if (live.body.messages.at(-1)?.text === "partial") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await call("POST", "/api/assistant/stop", {});
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(openaiStreamClosed, true);
});

test("stopping a streamed Claude reply aborts its SDK stream", async () => {
  anthropicStreamClosed = false;
  assert.equal((await call("POST", "/api/assistant/settings", { engine: "anthropic", model: "claude-stream-abort" })).status, 200);
  assert.equal((await call("POST", "/api/assistant/message", { text: "Stop this Claude stream" })).status, 202);
  for (let i = 0; i < 30; i++) {
    const live = await call("GET", "/api/assistant");
    if (live.body.messages.at(-1)?.text === "partial") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await call("POST", "/api/assistant/stop", {});
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(anthropicStreamClosed, true);
});

test("DeepSeek preset lists tool capability and prices a streamed usage reply", async () => {
  const baseUrl = `${fakeUrl}/deepseek`;
  const set = await call("POST", "/api/assistant/settings", { engine: "openai", base_url: baseUrl, key: GOOD_KEY, model: "deepseek-flash" });
  assert.equal(set.status, 200);
  const models = await call("GET", `/api/assistant/models?base_url=${encodeURIComponent(baseUrl)}`);
  assert.deepEqual(models.body.models.map((m) => [m.id, m.supports_tools]), [["deepseek-flash", true], ["deepseek-reasoner", false], ["deepseek-v4-pro", true]]);
  assert.deepEqual(models.body.models[0].pricing, { input: 0.0000003, output: 0.0000012, cache_hit: 0.000000006 });
  assert.match((await call("GET", "/api/assistant/deepseek-pricing")).body.line, /^(Peak price until \d{2}:00 UTC|Off-peak: half price)$/);
  const start = seen.length;
  assert.equal((await call("POST", "/api/assistant/message", { text: "Stream from DeepSeek" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.text, "DeepSeek streamed.");
  assert.equal(reply.usage.input_tokens, 10);
  assert.equal(reply.usage.output_tokens, 5);
  assert.equal(reply.usage.cache_read_input_tokens, 2);
  assert.equal(reply.usage.deepseek_cache_miss_tokens, 8);
  assert.ok(reply.usage.cost > 0);
  const request = seen.slice(start).find((r) => r.path === "/deepseek/chat/completions");
  assert.equal(request.body.stream, true);
  assert.ok(request.body.tools.length > 0);
  assert.equal(request.body.tool_choice, "auto");
});

test("DeepSeek 402 stops model fallback; 429 remains a transient rate limit", async () => {
  const baseUrl = `${fakeUrl}/deepseek`;
  await call("POST", "/api/assistant/settings", { engine: "openai", base_url: baseUrl, model: "deepseek-flash" });
  let start = seen.length;
  await call("POST", "/api/assistant/message", { text: "DEEPSEEK_402_TEST" });
  let reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error_kind, "quota");
  assert.equal(reply.error, "DeepSeek balance is empty");
  assert.equal(seen.slice(start).filter((r) => r.path === "/deepseek/chat/completions").length, 1);

  start = seen.length;
  await call("POST", "/api/assistant/message", { text: "DEEPSEEK_429_TEST" });
  reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error_kind, "rate_limit");
  assert.equal(reply.error, "DeepSeek is rate limited. Try again shortly.");
  assert.ok(seen.slice(start).filter((r) => r.path === "/deepseek/chat/completions").length > 1);
});

test("rate limits fall back to the next model of the same engine before any output", async () => {
  const set = await call("POST", "/api/assistant/settings", { engine: "openai", base_url: `${fakeUrl}/openai`, key: GOOD_KEY, model: "gpt-rate" });
  assert.equal(set.status, 200);
  const start = seen.length;
  assert.equal((await call("POST", "/api/assistant/message", { text: "What should I do next?" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error, null);
  assert.equal(reply.model, "gpt-test");
  assert.deepEqual(seen.slice(start).filter((r) => r.path === "/openai/chat/completions").map((r) => r.body.model), ["gpt-rate", "gpt-test", "gpt-test"]);
});

test("a later provider failure does not fall back after a tool action", async () => {
  const set = await call("POST", "/api/assistant/settings", { engine: "openai", base_url: `${fakeUrl}/openai`, key: GOOD_KEY, model: "gpt-partial" });
  assert.equal(set.status, 200);
  const start = seen.length;
  assert.equal((await call("POST", "/api/assistant/message", { text: "Set the focus timer" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error_kind, "rate_limit");
  assert.match(reply.error, /limit is reached/);
  assert.doesNotMatch(reply.error, /provider private/);
  assert.equal(reply.tools.length, 1);
  assert.deepEqual(seen.slice(start).filter((r) => r.path === "/openai/chat/completions").map((r) => r.body.model), ["gpt-partial", "gpt-partial"]);
});

test("an address that isn't https is refused", async () => {
  const r = await call("POST", "/api/assistant/settings", { engine: "openai", base_url: "http://10.0.0.1/v1", key: GOOD_KEY });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /https/);
});

test("fast-lane answers carry cards", async () => {
  assert.equal((await call("POST", "/api/assistant/message", { text: "set a 10 minute timer" })).status, 200);
  const done = await waitIdle();
  const reply = done.messages.at(-1);
  assert.equal(reply.quick, true);
  assert.equal(reply.cards[0].kind, "timer");
  assert.equal(reply.cards[0].duration_s, 600);
});
