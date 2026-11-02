// The assistant's engines: which AI answers, chosen per account in the app.
//
//   free       opencode's free models (the default; no key). Runs `opencode run`
//              in the sandbox, as before (assistant.js).
//   anthropic  Claude with the user's API key. Called here, with Hourglass's
//              tools run in this process: no CLI to start, so a reply takes a
//              second or two instead of 6-11 s.
//   openai     Any OpenAI-compatible API with the user's key: OpenAI,
//              OpenRouter, Gemini, Groq, or a custom URL. Same in-process tools.
//   claude     Claude through the user's Claude subscription (Pro/Max): a
//              token from `claude setup-token`, used by Claude Code
//              (`claude -p`) in the sandbox, which reaches Hourglass through
//              its MCP link. Claude Code starts a few seconds slower than a key.
//
// Keys are stored per account, encrypted with the server's own key
// (assistant.key in HOURGLASS_DATA), and never sent back to the apps.
import Anthropic from "@anthropic-ai/sdk";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TOOLS, runTool } from "./tools.js";
import { cardsFor, trimCards } from "./cards.js";
import { normalizeEngineError } from "./engine-errors.js";

export const ENGINES = [
  { id: "free", name: "Free", note: "opencode's free models. No key needed; slower." },
  { id: "claude", name: "Claude subscription", note: "Your Claude Pro or Max plan: sign in with your Claude account." },
  { id: "anthropic", name: "Claude API key", note: "Fastest. A key from console.anthropic.com; billed per use." },
  { id: "openai", name: "Other API key", note: "OpenAI, OpenRouter, Gemini, Groq, or any OpenAI-compatible API." },
];

// Claude models, newest first; the first is the default.
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "smartest" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "fast and smart" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "fastest" },
];

/** Claude's model catalogue does not currently promise context or price fields. */
export async function listAnthropicModels({ key, base_url = "https://api.anthropic.com" }) {
  const root = base_url.replace(/\/+$/, "");
  const res = await fetch(`${root}/v1/models?limit=1000`, {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `the API said ${res.status}`), { status: res.status, headers: res.headers, body, provider: "anthropic" });
  return (body.data || []).filter((m) => m?.id).map((m) => ({
    id: String(m.id),
    name: String(m.display_name || m.name || m.id),
    note: "",
    context_window: Number.isFinite(m.context_window) ? m.context_window : null,
    pricing: m.pricing && Number.isFinite(Number(m.pricing.input)) && Number.isFinite(Number(m.pricing.output))
      ? { input: Number(m.pricing.input), output: Number(m.pricing.output) } : null,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export const OPENAI_PRESETS = [
  { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1" },
  { id: "openrouter", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
  { id: "gemini", name: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "groq", name: "Groq", base_url: "https://api.groq.com/openai/v1" },
];

const TURN_SECONDS = 120;
const MAX_STEPS = 12; // model calls in one reply (each may run several tools)
const HISTORY_TURNS = 10; // earlier user/assistant exchanges sent along, as text

// --- settings and keys --------------------------------------------------------------

function serverKey(dataDir) {
  const f = join(dataDir, "assistant.key");
  if (!existsSync(f)) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(f, "utf8").trim(), "base64");
}

export function createSettings(dataDir) {
  const key = serverKey(dataDir);
  const seal = (text) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
  };
  const open = (sealed) => {
    try {
      const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  };
  const file = (t) => join(t.dir, "assistant_settings.json");
  const read = (t) => {
    try { return JSON.parse(readFileSync(file(t), "utf8")); } catch { return { engine: "free", model: null, base_url: null, keys: {} }; }
  };
  return {
    /** What the app may see: no keys, only whether one is saved. */
    view(t) {
      const s = read(t);
      return { engine: s.engine || "free", model: s.model || null, base_url: s.base_url || null, has_key: Object.fromEntries(Object.entries(s.keys || {}).map(([k, v]) => [k, !!v])) };
    },
    /** The full settings for running, keys opened. */
    get(t) {
      const s = read(t);
      const keys = {};
      for (const [k, v] of Object.entries(s.keys || {})) if (v) keys[k] = open(v);
      return { engine: s.engine || "free", model: s.model || null, base_url: s.base_url || null, keys };
    },
    save(t, { engine, model, base_url, key }) {
      const s = read(t);
      // A new engine without a model: its default (the old engine's model would not run on it).
      if (engine && engine !== s.engine && model === undefined) s.model = null;
      if (engine) s.engine = engine;
      if (model !== undefined) s.model = model || null;
      if (base_url !== undefined) s.base_url = base_url || null;
      s.keys ||= {};
      // A key belongs to its engine (and for openai, its URL): switching back keeps it.
      const slot = (engine || s.engine) === "openai" ? `openai:${s.base_url || ""}` : engine || s.engine;
      if (key !== undefined) s.keys[slot] = key ? seal(String(key).trim()) : null;
      writeFileSync(file(t), JSON.stringify(s), { mode: 0o600 });
      return this.view(t);
    },
    keySlot: (engine, base_url) => (engine === "openai" ? `openai:${base_url || ""}` : engine),
  };
}

// --- tools in this process --------------------------------------------------------------

function jsonSchema(input) {
  const schema = z.toJSONSchema(z.object(input));
  delete schema.$schema;
  return schema;
}

const TOOL_SCHEMAS = TOOLS.map((t) => ({ name: t.name, description: t.description, schema: jsonSchema(t.input) }));

/** Runs one tool for the model: its result (as text for the model), and the cards it makes. */
function callTool(service, name, args) {
  try {
    const result = runTool(service, name, args ?? {});
    return { ok: true, text: JSON.stringify(result ?? { ok: true }).slice(0, 12000), cards: cardsFor(service, name, args ?? {}, result) };
  } catch (e) {
    return { ok: false, text: `Error: ${e.message}`, cards: [] };
  }
}

// --- the prompt -------------------------------------------------------------------------

/** The standing instructions: the same on every request, so they cache. */
export function systemPrompt({ guide, instructions }) {
  return `You are the assistant inside Hourglass, the user's calendar, notes, alarms, timers and Drive app. You talk to the user inside the app and act on their data with the tools.

How to answer:
- Do what is asked, at once, with the tools. "Set my alarm in 1 hour", "tell me Sara's birthday", "add a lecture on Monday at 9": do it, then reply in one short sentence. The app draws a card for every alarm, timer, event and note you touch, so do not repeat the details the card shows.
- Never ask for confirmation before adding or changing alarms, timers, events, notes, clocks or settings. Fill gaps with the obvious choice: today or the next time it happens, an hour long, the label from the user's own words. Ask only when there is no sensible guess at all, and then ask one short question.
- Ask first only before deleting a note, removing a course, or removing a whole recurring series.
- Never argue, lecture or explain what you are about to do. If the user corrects you, apply the correction and say it is done.
- Never say something is done unless the tool succeeded. If a tool fails, say what went wrong in one sentence and what you will try or need.
- The message ends with a snapshot of the user's data with ids: when it answers the question, answer from it without a tool, and use its ids instead of looking them up.
- To find something by name (a person, a birthday, a file) use search once; birthdays and appointments are calendar events.
- Times are in the app's time zone (given in the snapshot). When the user names another zone ("9 PM EST"), convert it and say both times.
- Plain text, short sentences. No tables, headings or code blocks.

Hourglass data:
${instructions}

The app, for how-to questions:
${guide}`;
}

/** The earlier conversation as plain text turns (fast-lane answers included). */
export function historyTurns(chat, upTo) {
  const out = [];
  const msgs = chat.messages.slice(0, upTo).filter((m) => (m.text || "").trim() && !m.error);
  for (const m of msgs.slice(-HISTORY_TURNS * 2)) {
    const role = m.role === "user" ? "user" : "assistant";
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n" + m.text;
    else out.push({ role, content: m.text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// --- Claude with an API key -------------------------------------------------------------

async function runAnthropic({ key, model, system, history, userText, images, service, message, signal, onProgress, onStep }) {
  const client = new Anthropic({ apiKey: key, timeout: TURN_SECONDS * 1000, maxRetries: 1 });
  const id = model || CLAUDE_MODELS[0].id;
  const tools = TOOL_SCHEMAS.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(i === TOOL_SCHEMAS.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
  const content = [...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })), { type: "text", text: userText }];
  const messages = [...history, { role: "user", content }];
  // Opus 5.5 and Sonnet 5.5: if a safety check declines, the request is re-run on a fallback model.
  const fallback = /^claude-(opus|sonnet)-5-5$/.test(id);
  for (let step = 0; step < MAX_STEPS; step++) {
    const params = {
      model: id,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      output_config: { effort: "low" },
      // A readable summary of its thinking, for the "what it's doing" list.
      thinking: { type: "adaptive", display: "summarized" },
    };
    const sent = Date.now();
    const response = fallback
      ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
      : await client.messages.create(params, { signal });
    onStep(`Claude answered (${Math.round((Date.now() - sent) / 100) / 10} s)`);
    for (const b of response.content) if (b.type === "thinking" && (b.thinking || "").trim()) onStep(`Thinking: ${b.thinking.trim().replace(/\s+/g, " ").slice(0, 240)}`);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (text) message.text = text;
    if (response.stop_reason === "refusal") {
      message.text ||= "I can't help with that one.";
      return;
    }
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (!uses.length || response.stop_reason === "end_turn") return;
    if (response.stop_reason === "max_tokens") throw new Error("the reply was cut off");
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const u of uses) {
      const entry = { tool: u.name, status: "running" };
      message.tools.push(entry);
      onStep(`Using ${u.name}`);
      onProgress();
      const r = callTool(service, u.name, u.input);
      if (!r.ok) onStep(`${u.name} failed: ${r.text.slice(0, 160)}`);
      entry.status = r.ok ? "completed" : "error";
      message.cards = trimCards([...(message.cards || []), ...r.cards]);
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
    }
    onProgress();
    messages.push({ role: "user", content: results });
  }
}

// --- any OpenAI-compatible API ----------------------------------------------------------

async function runOpenAI({ key, base_url, model, system, history, userText, images, service, message, signal, onProgress, onStep }) {
  if (!model) throw Object.assign(new Error("pick a model in Settings first"), { status: 400 });
  const url = `${(base_url || OPENAI_PRESETS[0].base_url).replace(/\/+$/, "")}/chat/completions`;
  const tools = TOOL_SCHEMAS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
  const user = images.length
    ? [{ type: "text", text: userText }, ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))]
    : userText;
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: user }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_SECONDS * 1000)]),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body?.error?.message || `the API said ${res.status}`), { status: res.status, headers: res.headers, body, provider: "openai" });
    const choice = body.choices?.[0]?.message;
    if (!choice) throw new Error("the API sent no reply");
    if (choice.content) message.text = String(choice.content).trim();
    const calls = choice.tool_calls || [];
    if (!calls.length) return;
    messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: calls });
    for (const c of calls) {
      const entry = { tool: c.function?.name, status: "running" };
      message.tools.push(entry);
      onStep(`Using ${c.function?.name}`);
      onProgress();
      let args = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch {}
      const r = callTool(service, c.function?.name, args);
      entry.status = r.ok ? "completed" : "error";
      message.cards = trimCards([...(message.cards || []), ...r.cards]);
      messages.push({ role: "tool", tool_call_id: c.id, content: r.text });
    }
    onProgress();
  }
}

export async function listOpenAIModels({ key, base_url }) {
  const res = await fetch(`${(base_url || OPENAI_PRESETS[0].base_url).replace(/\/+$/, "")}/models`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `the API said ${res.status}`), { status: res.status, headers: res.headers, body, provider: "openai" });
  return (body.data || []).map((m) => {
    const id = String(m.id).replace(/^models\//, "");
    const context = Number(m.context_length);
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    return {
      id,
      name: String(m.name || m.display_name || id),
      context_window: Number.isFinite(context) && context > 0 ? context : null,
      pricing: Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Checks a key before saving it: true, or throws with what is wrong. */
export async function checkKey({ engine, key, base_url }) {
  if (engine === "anthropic") {
    const models = await listAnthropicModels({ key, ...(process.env.HOURGLASS_TEST_HTTP_API === "1" && process.env.ANTHROPIC_BASE_URL ? { base_url: process.env.ANTHROPIC_BASE_URL } : {}) });
    if (!models.length) throw new Error("Anthropic returned no models for this key.");
    return true;
  }
  if (engine === "openai") {
    await listOpenAIModels({ key, base_url });
    return true;
  }
  if (engine === "claude") {
    if (!/^sk-ant-oat\d*-/.test(key)) throw new Error("That doesn't look like a token from `claude setup-token` (it starts with sk-ant-oat).");
    return true;
  }
  return true;
}

/**
 * One reply on a direct engine (anthropic or openai): message.text, .tools and
 * .cards fill in as it works. Throws on a failure the user should see.
 */
export async function runDirect({ settings, system, chat, userText, images, service, message, signal, onProgress = () => {}, onStep = () => {}, onError = () => {}, timeZone = "UTC", claudeModels = CLAUDE_MODELS }) {
  const history = historyTurns(chat, chat.messages.length - 2);
  const key = settings.keys[settings.engine === "openai" ? `openai:${settings.base_url || ""}` : settings.engine];
  if (!key) throw new Error("Add your key in the assistant's settings first.");
  const args = { key, base_url: settings.base_url, model: settings.model, system, history, userText, images, service, message, signal, onProgress, onStep };
  const provider = settings.engine;
  const runModel = provider === "anthropic" ? runAnthropic : runOpenAI;
  const tried = new Set();
  let model = settings.model || (provider === "anthropic" ? CLAUDE_MODELS[0].id : "");
  let lastError;
  while (model && !tried.has(model)) {
    tried.add(model);
    args.model = model;
    let failure = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await runModel(args);
        return model;
      } catch (e) {
        const normalized = normalizeEngineError(e, { provider, status: e.status, headers: e.headers, body: e.body, timeZone });
        e.normalized = normalized;
        onError(e);
        e.logged = true;
        failure = e;
        if (message.text?.trim() || message.tools?.length || message.cards?.length) throw e;
        if (normalized.kind !== "network" && normalized.kind !== "overloaded") break;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    if (!failure) return;
    const kind = failure.normalized.kind;
    if (!["rate_limit", "quota", "overloaded", "network"].includes(kind)) throw failure;
    lastError = failure;
    let alternatives = [];
    if (provider === "anthropic") {
      const ids = claudeModels.map((m) => m.id);
      const index = ids.indexOf(model);
      alternatives = [...ids.slice(index + 1), ...ids.slice(0, Math.max(0, index))];
    } else {
      try {
        const ids = (await listOpenAIModels({ key, base_url: settings.base_url })).map((m) => m.id);
        const index = ids.indexOf(model);
        alternatives = index >= 0 ? [...ids.slice(index + 1), ...ids.slice(0, index)] : ids;
      } catch (e) {
        // Keep the actual completion failure as the user-visible and logged cause.
      }
    }
    model = alternatives.find((id) => !tried.has(id));
  }
  if (lastError) throw lastError;
}
