import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("health and window show stay responsive while a DPAPI read is in flight", { skip }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "hg-sidecar-startup-"));
  const configDir = join(temp, "config");
  const dataDir = join(temp, "data");
  const marker = join(temp, "keyring-started");
  const port = await freePort();
  const apiToken = "startup-test-token";
  let sidecar;

  try {
    await mkdir(configDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(configDir, "token"), `${apiToken}\n`);
    await writeFile(join(configDir, "session.dpapi"), "test-only placeholder\n");

    sidecar = spawn(process.execPath, ["--no-warnings", join(import.meta.dirname, "hourglassd.js")], {
      env: {
        ...process.env,
        HOURGLASS_CONFIG: configDir,
        HOURGLASS_DATA: dataDir,
        HOURGLASS_PORT: String(port),
        HOURGLASS_TEST_KEYRING_DELAY_MS: "2500",
        HOURGLASS_TEST_KEYRING_STARTED: marker,
        HOURGLASS_TEST_WINDOW: "1",
        HOURGLASS_SILENT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    sidecar.stdout.setEncoding("utf8");
    sidecar.stderr.setEncoding("utf8");
    sidecar.stdout.on("data", (chunk) => { output += chunk; });
    sidecar.stderr.on("data", (chunk) => { output += chunk; });

    try {
      await waitFor(async () => {
        try {
          return (await readFile(marker, "utf8")).includes("reading");
        } catch {
          return false;
        }
      });
    } catch (error) {
      assert.fail(`${error.message}\nSidecar output:\n${output}`);
    }

    const healthStart = performance.now();
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const healthMs = performance.now() - healthStart;
    assert.equal(health.status, 200, output);
    assert.ok(healthMs < 200, `health took ${healthMs.toFixed(1)} ms`);

    const showStart = performance.now();
    const show = await fetch(`http://127.0.0.1:${port}/api/window/show`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}` },
    });
    const showMs = performance.now() - showStart;
    assert.equal(show.status, 200, output);
    assert.deepEqual(await show.json(), { started: true });
    assert.ok(showMs < 200, `window show took ${showMs.toFixed(1)} ms`);
    console.log(`health ${healthMs.toFixed(1)} ms; window show ${showMs.toFixed(1)} ms during 2,500 ms keyring read`);
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
