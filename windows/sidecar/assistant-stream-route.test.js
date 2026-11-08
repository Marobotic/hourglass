import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the sidecar relays the assistant stream and passes a queue cancel through", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "hg-assistant-stream-"));
  const seen = [];
  const remote = createServer((req, res) => {
    if (req.url.startsWith("/api/assistant")) seen.push({ path: req.url, method: req.method, auth: req.headers.authorization });
    if (req.url === "/api/assistant/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: ready\ndata: {"state":"idle"}\n\n');
      res.write('event: text\ndata: {"message_id":"a1","delta":"Hi","text":"Hi"}\n\n');
      setTimeout(() => res.end(), 200);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, cancelled: req.url.split("/").pop() }));
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
    child = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "hourglassd.js")], {
      env: { ...process.env, HOURGLASS_CONFIG: config, HOURGLASS_DATA: join(dir, "data"), HOURGLASS_COURSES_DIR: join(dir, "courses"), HOURGLASS_PORT: String(port), HOURGLASS_SERVER: `http://127.0.0.1:${remote.address().port}`, HOURGLASS_PROVISION: "fake-session-token", HOURGLASS_SILENT: "1", HOURGLASS_UPDATE_FEED: "off" },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const base = `http://127.0.0.1:${port}`;
    const headers = { authorization: "Bearer fake-local-token" };
    let text = "";
    for (let i = 0; i < 150 && !text.includes("event: text"); i++) {
      try {
        const r = await fetch(base + "/api/assistant/stream", { headers });
        if (r.status === 200) {
          assert.match(r.headers.get("content-type"), /text\/event-stream/);
          text = await r.text();
        }
      } catch {}
      if (!text) await new Promise((r) => setTimeout(r, 100));
    }
    assert.match(text, /event: ready/);
    assert.match(text, /"delta":"Hi"/);
    assert.equal(seen.find((s) => s.path === "/api/assistant/stream").auth, "Bearer fake-session-token");
    const cancelled = await fetch(base + "/api/assistant/queue/q123", { method: "DELETE", headers });
    assert.equal((await cancelled.json()).cancelled, "q123");
    assert.equal(seen.at(-1).method, "DELETE");
  } finally {
    if (child && child.exitCode === null) await new Promise((r) => { child.once("exit", r); child.kill(); });
    remote.closeAllConnections();
    await new Promise((r) => remote.close(r));
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
