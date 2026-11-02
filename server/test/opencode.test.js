import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { opencodeProfileEnv, opencodeRunArgs, parseOpencodeModels } from "../opencode.js";

const captured = readFileSync(join(import.meta.dirname, "fixtures", "opencode-models-opencode.txt"), "utf8");

test("parses the captured opencode provider model list without relying on ID suffixes", () => {
  assert.deepEqual(parseOpencodeModels(captured), [
    "opencode/beam-free", "opencode/big-pickle", "opencode/deepseek-v4.1-flash-free",
    "opencode/flint-40b-free", "opencode/glm-5.3-flash-free", "opencode/mimo-v2.6-flash-free",
    "opencode/nemotron-3.5-lightning-free", "opencode/nemotron-3.5-super-vl-free",
  ]);
  assert.deepEqual(parseOpencodeModels(""), []);
});

test("child env keeps safe host values and redirects account and temp state into its profile", () => {
  const dirs = { home: "/acct/home", work: "/acct/work", config: "/acct/config", data: "/acct/data", state: "/acct/state", cache: "/acct/cache", temp: "/acct/temp" };
  const env = opencodeProfileEnv(dirs, {
    PATH: "/usr/bin", LANG: "en_US.UTF-8", LC_ALL: "C", NO_COLOR: "1", TZ: "UTC",
    DATABASE_URL: "secret", HOURGLASS_TOKEN: "secret", OPENAI_API_KEY: "secret", HOME: "/root", XDG_CONFIG_HOME: "/root/.config",
  });
  assert.deepEqual(env, {
    PATH: "/usr/bin", LANG: "en_US.UTF-8", LC_ALL: "C", NO_COLOR: "1", TZ: "UTC",
    HOME: "/acct/home", USERPROFILE: "/acct/home", XDG_CONFIG_HOME: "/acct/config", XDG_DATA_HOME: "/acct/data",
    XDG_STATE_HOME: "/acct/state", XDG_CACHE_HOME: "/acct/cache", TMPDIR: "/acct/temp", TMP: "/acct/temp", TEMP: "/acct/temp",
    OPENCODE_CONFIG: join("/acct/work", "opencode.json"),
  });
});

test("run args use stock supported options and keep sessions and attachments", () => {
  assert.deepEqual(opencodeRunArgs("opencode/big-pickle", "ses-1", ["uploads/a.png"]), [
    "run", "--format", "json", "-m", "opencode/big-pickle", "--session", "ses-1", "-f", "uploads/a.png",
  ]);
  assert.ok(!opencodeRunArgs("opencode/big-pickle", null).includes("--standalone"));
});
