import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { relayAssistantStream } from "./assistant-stream.js";

async function relayed(fetchImpl) {
  const server = createServer((req, res) => relayAssistantStream({ server: "http://up", headers: { authorization: "Bearer t" }, res, fetchImpl }));
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const text = await r.text();
  server.close();
  return { status: r.status, type: r.headers.get("content-type"), text };
}

test("the stream is relayed with the session and ends when the server ends", async () => {
  let seen;
  const body = new Response("event: ready\ndata: {}\n\nevent: state\ndata: {\"busy\":true}\n\n").body;
  const out = await relayed(async (url, opts) => { seen = { url, auth: opts.headers.authorization, accept: opts.headers.accept }; return { ok: true, status: 200, body }; });
  assert.equal(seen.url, "http://up/api/assistant/stream");
  assert.equal(seen.auth, "Bearer t");
  assert.equal(out.status, 200);
  assert.match(out.type, /text\/event-stream/);
  assert.match(out.text, /event: ready/);
  assert.match(out.text, /"busy":true/);
});

test("an older server without the stream answers 404 so the window keeps polling", async () => {
  const out = await relayed(async () => ({ ok: false, status: 404, json: async () => ({ error: "not found" }) }));
  assert.equal(out.status, 404);
});

test("an unreachable server answers 503", async () => {
  const out = await relayed(async () => { throw new Error("down"); });
  assert.equal(out.status, 503);
});
