import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("assistant proxy forwards provider/key/model and preserves a session after a rejected provider key", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "hg-assistant-proxy-"));
  const seen = [];
  const remote = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : null;
    if (req.url.startsWith("/api/assistant")) seen.push({ path: req.url, method: req.method, data, auth: req.headers.authorization });
    const bad = data?.key === "fake-rejected";
    res.writeHead(bad ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(bad ? { error: "Key rejected" } : req.url.includes("/models") ? { models: [{ id: "provider-model" }] } : { engine: "openai", base_url: data?.base_url, model: data?.model, has_key: { ["openai:" + data?.base_url]: true } }));
  });
  let child;
  try {
    await new Promise((r) => remote.listen(0, "127.0.0.1", r));
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const config = join(dir, "config");
    await mkdir(config);
    await writeFile(join(config, "token"), "fake-local-token\n");
    let output = "";
    child = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "hourglassd.js")], {
      env: { ...process.env, HOURGLASS_CONFIG: config, HOURGLASS_DATA: join(dir, "data"), HOURGLASS_COURSES_DIR: join(dir, "courses"), HOURGLASS_PORT: String(port), HOURGLASS_SERVER: `http://127.0.0.1:${remote.address().port}`, HOURGLASS_PROVISION: "fake-session-token", HOURGLASS_SILENT: "1", HOURGLASS_UPDATE_FEED: "off" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (x) => { output += x; });
    child.stderr.on("data", (x) => { output += x; });
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: "Bearer fake-local-token", "content-type": "application/json" };
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        const r = await fetch(base + "/api/assistant/settings", { headers });
        if ((await r.json()).engine === "openai") { ready = true; break; }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, output);
    for (const provider of ["deepseek", "openai", "openrouter", "gemini", "groq"]) {
      const body = { engine: "openai", base_url: `https://${provider}.example/v1`, key: `fake-${provider}`, model: "provider-model" };
      const r = await fetch(base + "/api/assistant/settings", { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(r.status, 200);
      assert.deepEqual(seen.at(-1).data, body);
      assert.equal(seen.at(-1).auth, "Bearer fake-session-token");
      const path = "/api/assistant/models?base_url=" + encodeURIComponent(body.base_url);
      assert.equal((await (await fetch(base + path, { headers })).json()).models[0].id, "provider-model");
      assert.equal(seen.at(-1).path, path);
    }
    const rejected = await fetch(base + "/api/assistant/settings", { method: "POST", headers, body: JSON.stringify({ engine: "openai", key: "fake-rejected" }) });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "Key rejected");
    await fetch(base + "/api/assistant/settings", { headers });
    assert.equal(seen.at(-1).auth, "Bearer fake-session-token");
    for (const name of await readdir(config)) assert.equal((await readFile(join(config, name), "utf8")).includes("fake-deepseek"), false, "provider key is never saved in sidecar config");
  } finally {
    if (child && child.exitCode === null) await new Promise((r) => { child.once("exit", r); child.kill(); });
    remote.closeAllConnections();
    await new Promise((r) => remote.close(r));
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
