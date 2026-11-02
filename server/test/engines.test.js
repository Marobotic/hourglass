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
        { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-01-01T00:00:00Z" },
        { type: "model", id: "claude-live-custom", display_name: "Claude Live Custom", created_at: "2026-01-01T00:00:00Z" },
      ], has_more: false });
      if (req.url.startsWith("/v1/messages")) {
        const done = json.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"));
        const usage = { input_tokens: 10, output_tokens: 5 };
        if (!done) return send(200, { id: "msg_1", type: "message", role: "assistant", model: json.model, stop_reason: "tool_use", usage,
          content: [{ type: "tool_use", id: "tu_1", name: "set_alarm", input: { label: "Gym", time: "07:30", days: ["Mon", "Wed"] } }] });
        return send(200, { id: "msg_2", type: "message", role: "assistant", model: json.model, stop_reason: "end_turn", usage, content: [{ type: "text", text: "Done." }] });
      }
      if (req.url === "/openai/models") return send(200, { data: ["gpt-test", "gpt-other", "gpt-rate", "gpt-alt", "gpt-partial"].map((id) => ({ id, name: `Display ${id}`, context_length: id === "gpt-test" ? 128000 : undefined, pricing: id === "gpt-test" ? { prompt: "0.000002", completion: "0.000008" } : undefined })) });
      if (req.url === "/openai/chat/completions") {
        const done = json.messages.some((m) => m.role === "tool");
        if (json.model === "gpt-rate") return send(429, { error: { code: "rate_limit_exceeded", message: "provider private rate limit detail" } }, { "retry-after": "3" });
        if (json.model === "gpt-partial" && done) return send(429, { error: { code: "rate_limit_exceeded", message: "provider private late limit detail" } }, { "retry-after": "3" });
        if (!done) return send(200, { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "start_timer", arguments: JSON.stringify({ minutes: 25, label: "Focus" }) } }] } }] });
        return send(200, { choices: [{ message: { role: "assistant", content: "Timer's on." } }] });
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
  assert.equal(reply.text, "Done.");
  assert.equal(reply.model, "claude-haiku-5-5");
  assert.deepEqual(reply.tools.map((x) => [x.tool, x.status]), [["set_alarm", "completed"]]);
  assert.equal(reply.cards.length, 1);
  assert.equal(reply.cards[0].kind, "alarm");
  assert.equal(reply.cards[0].label, "Gym");
  assert.equal(reply.cards[0].when, "Mon, Wed");
  assert.equal(reply.cards[0].time, "7:30 AM");
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
  assert.deepEqual(models.body.models.map((m) => m.id), ["gpt-alt", "gpt-other", "gpt-partial", "gpt-rate", "gpt-test"]);
  const rich = models.body.models.find((m) => m.id === "gpt-test");
  assert.equal(rich.name, "Display gpt-test");
  assert.equal(rich.context_window, 128000);
  assert.deepEqual(rich.pricing, { input: 0.000002, output: 0.000008 });
  assert.equal(models.body.models.find((m) => m.id === "gpt-other").context_window, null);
  assert.equal(models.body.models.find((m) => m.id === "gpt-other").pricing, null);
  assert.equal((await call("POST", "/api/assistant/message", { text: "focus timer please, 25 min" })).status, 202);
  const reply = (await waitIdle()).messages.at(-1);
  assert.equal(reply.error, null);
  assert.equal(reply.text, "Timer's on.");
  assert.equal(reply.cards[0].kind, "timer");
  assert.equal(reply.cards[0].label, "Focus");
  assert.equal(reply.cards[0].duration_s, 1500);
  // The earlier exchange went along as history.
  const req = seen.filter((r) => r.path === "/openai/chat/completions")[0].body;
  assert.ok(req.messages.some((m) => m.role === "assistant" && m.content === "Done."));
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
