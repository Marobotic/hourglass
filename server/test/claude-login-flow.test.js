import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const unixScriptAvailable = process.platform !== "win32" && spawnSync("sh", ["-lc", "command -v script"], { encoding: "utf8" }).status === 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("Claude login status moves through waiting_code, error, checking, and connected with a fake CLI", { skip: !unixScriptAvailable }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "hg-claude-login-flow-"));
  const fakeClaude = join(data, "fake-claude-login.mjs");
  copyFileSync(join(here, "fake-claude-login.mjs"), fakeClaude);
  chmodSync(fakeClaude, 0o755);
  const probe = createHttpServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HOURGLASS_DATA: data,
    HOURGLASS_PORT: String(port),
    HOURGLASS_HOST: "127.0.0.1",
    HOURGLASS_TOKEN: "claude-login-flow-test-owner",
    HOURGLASS_URL: base,
    HOURGLASS_ASSISTANT: "on",
    HOURGLASS_ASSISTANT_RUNNER: "direct",
    HOURGLASS_ASSISTANT_BIN: join(here, "fake-opencode.mjs"),
    HOURGLASS_ASSISTANT_DIR: join(data, "assistant-accounts"),
    HOURGLASS_CLAUDE_BIN: fakeClaude,
    MARO_ACCOUNT_URL: "http://127.0.0.1:9",
  };
  const server = spawn(process.execPath, ["--no-warnings", join(here, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (d) => { output += d; });
  server.stderr.on("data", (d) => { output += d; });
  t.after(async () => {
    if (server.exitCode === null) { server.kill(); await new Promise((resolve) => server.once("exit", resolve)); }
    rmSync(data, { recursive: true, force: true, maxRetries: 5 });
  });

  const headers = { authorization: "Bearer claude-login-flow-test-owner", "content-type": "application/json" };
  const call = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    // The listen line: the assistant's own startup line names the same address earlier.
    if (output.includes(` on http://127.0.0.1:${port}`)) { ready = true; break; }
    if (server.exitCode !== null) break;
    await wait(50);
  }
  assert.ok(ready, `server did not start: ${output}`);

  const started = await call("POST", "/api/assistant/claude/login");
  assert.equal(started.status, 200);
  assert.match(started.body.url, /^https:\/\/claude\.com\/oauth\/authorize/);
  assert.equal((await call("GET", "/api/assistant/claude/login/status")).body.state, "waiting_code");

  const submitted = await call("POST", "/api/assistant/claude/login/code", { code: "fakecode123#fakestate", async: true });
  assert.equal(submitted.status, 202);
  assert.equal(submitted.body.state, "connecting");
  let failed;
  for (let i = 0; i < 100; i++) {
    failed = (await call("GET", "/api/assistant/claude/login/status")).body;
    if (failed.state === "error") break;
    await wait(50);
  }
  assert.equal(failed.state, "error", JSON.stringify(failed));
  assert.match(failed.message, /wasn't accepted/);
  // The whole code#state reached the CLI's exchange, submitted by an Enter of its own.
  assert.doesNotMatch(failed.message, /full code was copied/);
  assert.doesNotMatch(failed.message, /fakecode123|fakestate/);

  const direct = await call("POST", "/api/assistant/claude/login/code", { code: "sk-ant-oat01-FAKE_TEST_TOKEN", async: true });
  assert.equal(direct.status, 202);
  assert.equal((await call("GET", "/api/assistant/claude/login/status")).body.state, "checking");
  let connected;
  for (let i = 0; i < 100; i++) {
    connected = (await call("GET", "/api/assistant/claude/login/status")).body;
    if (connected.state === "connected") break;
    await wait(50);
  }
  assert.deepEqual(connected, { state: "connected", message: "Connected as Claude Pro/Max" });
});
