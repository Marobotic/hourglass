import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings, engineEntries, listOpenAIModels, OPENAI_PRESETS } from "../engines.js";

test("every provider keeps its encrypted key and last model across store restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "hg-settings-"));
  const account = { dir };
  try {
    let settings = createSettings(dir);
    const providers = [
      ...OPENAI_PRESETS.map((p) => ({ engine: "openai", base_url: p.base_url, name: p.name })),
      { engine: "anthropic", name: "Anthropic" },
      { engine: "claude", name: "Claude subscription" },
      { engine: "openai", base_url: "https://custom.example/v1", name: "https://custom.example/v1" },
    ];
    for (const [i, provider] of providers.entries()) settings.save(account, { ...provider, key: `fake-secret-${i}`, model: `provider-model-${i}` });
    settings = createSettings(dir);
    for (const [i, provider] of providers.entries()) {
      const view = settings.save(account, provider);
      assert.equal(view.engine_name, provider.name);
      assert.equal(view.model, `provider-model-${i}`);
      const slot = settings.keySlot(provider.engine, provider.base_url);
      assert.equal(view.has_key[slot], true);
      assert.equal(settings.get(account).keys[slot], `fake-secret-${i}`);
      assert.equal(JSON.stringify(view).includes("fake-secret"), false);
      assert.ok(engineEntries(view).some((e) => e.name === provider.name));
    }
    assert.equal(readFileSync(join(dir, "assistant_settings.json"), "utf8").includes("fake-secret"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy settings migrate the active model and retain encrypted blobs", () => {
  const dir = mkdtempSync(join(tmpdir(), "hg-settings-legacy-"));
  const account = { dir };
  try {
    const settings = createSettings(dir);
    settings.save(account, { engine: "openai", base_url: "https://api.deepseek.com/", key: "fake-legacy", model: "deepseek-chat" });
    const file = join(dir, "assistant_settings.json");
    const legacy = JSON.parse(readFileSync(file, "utf8"));
    delete legacy.models;
    writeFileSync(file, JSON.stringify(legacy));
    settings.save(account, { engine: "free", model: "opencode/big-pickle" });
    assert.equal(settings.save(account, { engine: "openai", base_url: "https://api.deepseek.com" }).model, "deepseek-chat");
    assert.equal(settings.get(account).keys["openai:https://api.deepseek.com"], "fake-legacy");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).keys, legacy.keys);
    const coerced = JSON.parse(readFileSync(file, "utf8"));
    coerced.model = "null";
    coerced.models["openai:https://api.deepseek.com"] = "null";
    writeFileSync(file, JSON.stringify(coerced));
    assert.equal(settings.view(account).model, null);
    assert.equal(settings.view(account).models["openai:https://api.deepseek.com"], null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Gemini discovers generation models from its native catalogue without putting the key in the URL", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ models: [
      { name: "models/gemini-live", displayName: "Gemini Live", inputTokenLimit: 1000000, supportedGenerationMethods: ["generateContent"] },
      { name: "models/embedding-only", supportedGenerationMethods: ["embedContent"] },
    ] }), { status: 200 });
  });
  const models = await listOpenAIModels({ key: "fake-gemini-catalogue", base_url: OPENAI_PRESETS.find((p) => p.id === "gemini").base_url });
  assert.deepEqual(models.map((m) => m.id), ["gemini-live"]);
  assert.equal(models[0].name, "Gemini Live");
  assert.equal(models[0].context_window, 1000000);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(calls[0].options.headers["x-goog-api-key"], "fake-gemini-catalogue");
});
