// A free model that stalls is stopped after a short silence and the next one
// answers; the message's steps say what happened, live.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "owner-token-for-tests";
let hg, base, data;

before(async () => {
  data = mkdtempSync(join(tmpdir(), "hg-watchdog-"));
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, HOURGLASS_DATA: data, HOURGLASS_PORT: String(port), HOURGLASS_HOST: "127.0.0.1", HOURGLASS_TOKEN: TOKEN,
    MARO_ACCOUNT_URL: "http://127.0.0.1:9", HOURGLASS_URL: base, HOURGLASS_ASSISTANT: "on", HOURGLASS_ASSISTANT_RUNNER: "direct",
    HOURGLASS_ASSISTANT_BIN: join(import.meta.dirname, "fake-opencode.mjs"), HOURGLASS_ASSISTANT_DIR: join(data, "acc"),
    HOURGLASS_ASSISTANT_MODELS: "fake/stuck,fake/good", HOURGLASS_ASSISTANT_FIRST_WORD_S: "2", HOURGLASS_ASSISTANT_QUIET_S: "2",
  };
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
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("a stalled free model is dropped after its silence and the next one answers, with the steps shown", async () => {
  const t0 = Date.now();
  assert.equal((await call("POST", "/api/assistant/message", { text: "Buy eggs and milk" })).status, 202);
  let seenSteps = false;
  let r;
  for (let i = 0; i < 300; i++) {
    r = await call("GET", "/api/assistant");
    if (r.body.busy && (r.body.messages.at(-1).steps || []).length) seenSteps = true;
    if (!r.body.busy) break;
    await new Promise((x) => setTimeout(x, 50));
  }
  const reply = r.body.messages.at(-1);
  assert.ok(seenSteps, "steps show while it works");
  assert.equal(reply.error, null);
  assert.equal(reply.model, "fake/good");
  const steps = reply.steps.map((s) => s.text);
  assert.match(steps[0], /Asking fake\/stuck/);
  assert.ok(steps.some((s) => /fake\/stuck went quiet/.test(s)), steps.join(" | "));
  assert.ok(steps.some((s) => /Trying fake\/good/.test(s)));
  assert.ok(Date.now() - t0 < 12000, "dropped within seconds");
});
