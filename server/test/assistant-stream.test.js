// The stream wire pieces: trimming, the per-account hub, and the mirror that
// turns a changing assistant message into text/tool/usage events.
import test from "node:test";
import assert from "node:assert/strict";
import { createEventHub, createStreamMirror, trimToolValue } from "../assistant-stream.js";

function fakeRes() {
  const chunks = [];
  return { chunks, write: (chunk) => { chunks.push(chunk); return true; }, on() {}, destroyed: false };
}

test("tool input and output are trimmed to one short string", () => {
  assert.equal(trimToolValue(undefined), null);
  assert.equal(trimToolValue("short"), "short");
  assert.equal(trimToolValue({ a: 1 }), '{"a":1}');
  const long = trimToolValue("x".repeat(50), 20);
  assert.match(long, /^x{20}… \(30 more characters\)$/);
});

test("the event hub fans out per account and drops a closed stream", () => {
  const hub = createEventHub({ heartbeatMs: 1_000_000 });
  const a = fakeRes(), b = fakeRes(), other = fakeRes();
  hub.subscribe("a@example.com", a);
  hub.subscribe("a@example.com", b);
  hub.subscribe("b@example.com", other);
  assert.equal(hub.count("a@example.com"), 2);
  assert.equal(hub.emit("a@example.com", "text", { delta: "hi" }), 2);
  assert.match(a.chunks[0], /^event: text\ndata: \{"delta":"hi"\}\n\n$/);
  assert.match(b.chunks[0], /"delta":"hi"/);
  assert.deepEqual(other.chunks, []);
  hub.close("a@example.com");
  assert.equal(hub.count("a@example.com"), 0);
  assert.equal(hub.emit("a@example.com", "text", {}), 0);
  hub.closeAll();
});

test("the mirror emits text deltas once, then tool start/end and usage", () => {
  const events = [];
  const message = { id: "a1", role: "assistant", text: "", tools: [] };
  const mirror = createStreamMirror({ message, emit: (event, data) => events.push([event, data]), now: () => 1000 });
  mirror.sync();
  assert.deepEqual(events, []);
  message.text = "Hello";
  mirror.sync();
  assert.deepEqual(events.at(-1), ["text", { message_id: "a1", delta: "Hello", text: "Hello" }]);
  message.text = "Hello there";
  mirror.sync();
  assert.deepEqual(events.at(-1), ["text", { message_id: "a1", delta: " there", text: "Hello there" }]);

  message.tools.push({ call_id: "c1", tool: "add_note", status: "running", label: "Writing a note", input: { title: "x" } });
  mirror.sync();
  assert.equal(events.at(-1)[0], "tool_start");
  assert.equal(events.at(-1)[1].tool, "add_note");
  assert.equal(events.at(-1)[1].input, '{"title":"x"}');

  const entry = message.tools[0];
  Object.assign(entry, { status: "completed", output: { ok: true }, duration_ms: 42, diff: { added: 1, removed: 0 } });
  mirror.sync();
  assert.equal(events.at(-1)[0], "tool_end");
  assert.equal(events.at(-1)[1].status, "completed");
  assert.equal(events.at(-1)[1].duration_ms, 42);
  assert.deepEqual(events.at(-1)[1].diff, { added: 1, removed: 0 });

  message.usage = { input_tokens: 10, output_tokens: 2, cost: 0.01, context_percent: 4 };
  message.model = "claude-haiku-5-5";
  mirror.sync();
  assert.deepEqual(events.at(-1), ["usage", { message_id: "a1", model: "claude-haiku-5-5", input_tokens: 10, output_tokens: 2, cost: 0.01, context_percent: 4 }]);

  mirror.end();
  const end = events.at(-1);
  assert.equal(end[0], "message_end");
  assert.equal(end[1].text, "Hello there");
  assert.equal(end[1].model, "claude-haiku-5-5");
  assert.equal(end[1].error, null);
});

test("the mirror replaces text when an engine rewrites its answer", () => {
  const events = [];
  const message = { id: "a2", text: "draft", tools: [] };
  const mirror = createStreamMirror({ message, emit: (event, data) => events.push([event, data]) });
  mirror.sync();
  message.text = "final";
  mirror.sync();
  assert.deepEqual(events.at(-1), ["text", { message_id: "a2", delta: "", text: "final", replace: true }]);
});
