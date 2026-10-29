import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skip = process.platform !== "win32";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("condition was not met before timeout");
}

// A window in the tray asks once and the service holds the answer: one idle
// request instead of a poll every few hundred ms, and the window still comes
// back the moment the launcher asks for it.
test("a window waiting for show_seq is answered as soon as it moves", { skip }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-sidecar-window-"));
  const configDir = join(temp, "config");
  const dataDir = join(temp, "data");
  const port = await freePort();
  const apiToken = "window-test-token";
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${apiToken}` };
  let sidecar;

  try {
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(configDir, "token"), `${apiToken}\n`);

    sidecar = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "hourglassd.js")], {
      env: {
        ...process.env,
        HOURGLASS_CONFIG: configDir,
        HOURGLASS_DATA: dataDir,
        HOURGLASS_PORT: String(port),
        HOURGLASS_TEST_WINDOW: "1",
        HOURGLASS_UPDATE_FEED: "off",
        HOURGLASS_SILENT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    sidecar.stdout.setEncoding("utf8");
    sidecar.stderr.setEncoding("utf8");
    sidecar.stdout.on("data", (chunk) => { output += chunk; });
    sidecar.stderr.on("data", (chunk) => { output += chunk; });
    await waitFor(async () => {
      try {
        return (await fetch(`${base}/health`)).status === 200;
      } catch {
        return false;
      }
    });

    // No `since`: a plain question answered at once (an older window asks this way).
    const plain = await fetch(`${base}/api/window`, { headers: auth });
    assert.equal(plain.status, 200, output);
    const state = await plain.json();
    assert.equal(state.show_seq, 0);

    // With `since`: held, because nothing has moved yet.
    let answered = null;
    const heldStart = performance.now();
    const held = fetch(`${base}/api/window?since=0`, { headers: auth })
      .then((r) => r.json())
      .then((d) => { answered = d; return performance.now() - heldStart; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(answered, null, `the answer came before anything asked for the window:\n${output}`);

    const show = await fetch(`${base}/api/window/show`, { method: "POST", headers: auth });
    assert.equal(show.status, 200, output);
    const heldMs = await held;
    assert.equal(answered.show_seq, 1, output);
    assert.ok(heldMs < 1500, `the window waited ${heldMs.toFixed(0)} ms after being asked for`);
  } finally {
    if (sidecar) {
      await new Promise((resolve) => {
        if (sidecar.exitCode !== null) return resolve();
        sidecar.once("exit", resolve);
        sidecar.kill();
      });
    }
    await rm(temp, { recursive: true, force: true, maxRetries: 5 });
  }
});
