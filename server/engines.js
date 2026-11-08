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
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TOOLS, planBlocked, runTool, needsApproval, toolPermission } from "./tools.js";
import { cardsFor, trimCards } from "./cards.js";
import { normalizeEngineError } from "./engine-errors.js";
import { deepSeekCost, deepSeekModelPricing, deepSeekModelSupportsTools, isDeepSeekBaseUrl } from "./deepseek.js";
import { trimToolValue } from "./assistant-stream.js";

export const ENGINES = [
  { id: "free", name: "Free", note: "opencode's free models. No key needed; slower." },
  { id: "claude", name: "Claude subscription", note: "Your Claude Pro or Max plan: sign in with your Claude account." },
  { id: "anthropic", name: "Anthropic", note: "Claude API key from console.anthropic.com; billed per use." },
  { id: "openai", name: "Other API key", note: "OpenAI, OpenRouter, Gemini, Groq, or any OpenAI-compatible API." },
];

// Reasoning effort a model can be asked for. "none" and "max" exist on some
// providers but not across them; the four engines all understand these three.
export const EFFORTS = ["low", "medium", "high"];

/** What this engine+model can be asked for; [] means it is not supported there. */
export function effortsFor(engine, model, base_url) {
  if (engine === "openai") return isDeepSeekBaseUrl(base_url) ? [] : EFFORTS;
  if (["free", "claude", "anthropic"].includes(engine)) return EFFORTS;
  return [];
}

/**
 * Direct engines can take another user message between their steps (steering
 * mid-run). The CLI engines take one prompt per process, so a message sent
 * while one runs is queued for the next turn instead.
 */
export function supportsSteer(engine) {
  return engine === "anthropic" || engine === "openai";
}

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
    pricing: m.pricing && m.pricing.input != null && m.pricing.output != null && Number.isFinite(Number(m.pricing.input)) && Number.isFinite(Number(m.pricing.output))
      ? { input: Number(m.pricing.input), output: Number(m.pricing.output) } : null,
    efforts: effortsFor("anthropic", String(m.id)),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export const OPENAI_PRESETS = [
  { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1" },
  { id: "openrouter", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
  { id: "gemini", name: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "groq", name: "Groq", base_url: "https://api.groq.com/openai/v1" },
  { id: "deepseek", name: "DeepSeek", base_url: "https://api.deepseek.com" },
];

const openaiModelCache = new Map();

export const apiUrl = (url) => String(url || OPENAI_PRESETS[0].base_url).trim().replace(/\/+$/, "");
export const engineSlot = (engine, url) => engine === "openai" ? `openai:${apiUrl(url)}` : engine;
export function engineName(engine, url) {
  return engine === "openai"
    ? OPENAI_PRESETS.find((p) => apiUrl(p.base_url) === apiUrl(url))?.name || apiUrl(url)
    : ENGINES.find((e) => e.id === engine)?.name || engine;
}

// Protocol ids remain compatible with older clients; URL is part of an API engine's identity.
export function engineEntries(view) {
  const urls = new Set([...OPENAI_PRESETS.map((p) => p.base_url), ...Object.keys(view.has_key).filter((k) => view.has_key[k] && k.startsWith("openai:")).map((k) => k.slice(7))]);
  return [...ENGINES.filter((e) => e.id !== "openai"), ...[...urls].map((url) => ({
    id: "openai", base_url: url, name: engineName("openai", url),
    note: view.has_key[engineSlot("openai", url)] ? "Key saved · select to use" : "Add an API key",
  })), { id: "openai", base_url: "", name: "Custom API", note: "Any OpenAI-compatible API address." }];
}

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
    try {
      const s = JSON.parse(readFileSync(file(t), "utf8"));
      if (s.model === "null") s.model = null; // old Android JSON null coercion
      if (s.models) s.models = Object.fromEntries(Object.entries(s.models).map(([slot, model]) => [slot, model === "null" ? null : model]));
      // Efforts are per engine slot and model; old files simply have none.
      if (s.efforts) s.efforts = Object.fromEntries(Object.entries(s.efforts).map(([slot, efforts]) => [engineSlot(slot), Object.fromEntries(Object.entries(efforts || {}).map(([model, effort]) => [model, effort === "null" ? null : effort]))]));
      // Preserve existing encrypted blobs while accepting older URL spellings.
      s.keys = Object.fromEntries(Object.entries(s.keys || {}).map(([slot, value]) => [slot.startsWith("openai:") ? engineSlot("openai", slot.slice(7)) : slot, value]));
      if (s.engine === "openai") s.base_url = apiUrl(s.base_url);
      return s;
    } catch { return { engine: "free", model: null, base_url: null, keys: {} }; }
  };
  return {
    /** What the app may see: no keys, only whether one is saved. */
    view(t) {
      const s = read(t);
      const slot = engineSlot(s.engine || "free", s.base_url);
      const models = { ...s.models, [slot]: s.model || null };
      const efforts = s.efforts || {};
      return {
        engine: s.engine || "free", engine_name: engineName(s.engine || "free", s.base_url), model: s.model || null,
        effort: efforts[slot]?.[s.model || ""] || null,
        efforts,
        models, base_url: s.base_url || null,
        has_key: Object.fromEntries(Object.entries(s.keys || {}).map(([k, v]) => [k, !!v])),
      };
    },
    /** The full settings for running, keys opened. */
    get(t) {
      const s = read(t);
      const keys = {};
      for (const [k, v] of Object.entries(s.keys || {})) if (v) keys[k] = open(v);
      return { ...this.view(t), keys };
    },
    save(t, { engine, model, base_url, key, effort }) {
      const s = read(t);
      const previous = engineSlot(s.engine || "free", s.base_url);
      s.models ||= {};
      s.models[previous] = s.model || null;
      if (engine) s.engine = engine;
      if (base_url !== undefined) s.base_url = apiUrl(base_url);
      if (s.engine === "openai") s.base_url = apiUrl(s.base_url);
      const slot = engineSlot(s.engine || "free", s.base_url);
      s.model = model !== undefined ? model || null : s.models[slot] || null;
      s.models[slot] = s.model;
      // The effort belongs to this engine (and URL) and model, so switching back keeps it.
      if (effort !== undefined) {
        s.efforts ||= {};
        (s.efforts[slot] ||= {})[s.model || ""] = effort || null;
      }
      s.keys ||= {};
      // A key belongs to its engine (and for openai, its URL): switching back keeps it.
      if (key !== undefined) s.keys[slot] = key ? seal(String(key).trim()) : null;
      writeFileSync(file(t), JSON.stringify(s), { mode: 0o600 });
      return this.view(t);
    },
    keySlot: engineSlot,
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
function callTool(service, name, args, mode = "auto", message = null) {
  try {
    if (planBlocked(mode, name, service, args)) {
      return { ok: false, text: `Plan mode is on: ${name} would change data, so it was not run. Say what you would change and wait for the user to switch modes.`, cards: [] };
    }
    if (needsApproval(mode, name, service, args)) {
      const tool = TOOLS.find((t) => t.name === name);
      const fileSnapshot = name === "write_file" || name === "edit_file";
      const action = { id: randomBytes(12).toString("base64url"), tool: name, args: args ?? {}, summary: `${tool.title}: ${JSON.stringify(args ?? {})}`.slice(0, 500), risky: toolPermission(name, service, args) === "risky", file_snapshot: fileSnapshot, file_sha256: service.driveFiles?.hashFor?.(name, args), status: "pending" };
      (message.pending_actions ||= []).push(action);
      const card = { kind: "action", ...action };
      return { ok: true, text: `Waiting for the user to approve: ${action.summary}`, cards: [card] };
    }
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
- Follow the permission mode stated for this chat. If a tool result says an action is waiting for approval, explain that plainly and do not say it is done. Fill gaps with the obvious choice: today or the next time it happens, an hour long, the label from the user's own words. Ask only when there is no sensible guess at all, and then ask one short question.
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

export function recordAssistantUsage(message, usage, metadata) {
  const has = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "deepseek_cache_hit_tokens", "deepseek_cache_miss_tokens"].some((k) => usage?.[k] != null && Number.isFinite(Number(usage[k])));
  if (!has) return;
  const u = message.usage ||= { input_tokens: null, output_tokens: null, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost: null, context_window: null, context_percent: null };
  for (const [target, source] of [["input_tokens", "input_tokens"], ["output_tokens", "output_tokens"], ["cache_read_input_tokens", "cache_read_input_tokens"], ["cache_creation_input_tokens", "cache_creation_input_tokens"]]) {
    if (usage?.[source] != null && Number.isFinite(Number(usage[source]))) u[target] = (u[target] || 0) + Number(usage[source]);
  }
  const input = usage.input_tokens != null && Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : 0;
  const cachedRead = usage.cache_read_input_tokens != null && Number.isFinite(Number(usage.cache_read_input_tokens)) ? Number(usage.cache_read_input_tokens) : 0;
  const cachedWrite = usage.cache_creation_input_tokens != null && Number.isFinite(Number(usage.cache_creation_input_tokens)) ? Number(usage.cache_creation_input_tokens) : 0;
  const contextInput = usage.context_input_tokens != null && Number.isFinite(Number(usage.context_input_tokens)) ? Number(usage.context_input_tokens) : input + cachedRead + cachedWrite;
  u.context_window = Number.isFinite(metadata?.context_window) && metadata.context_window > 0 ? metadata.context_window : null;
  u.context_percent = u.context_window && contextInput ? Math.round(contextInput / u.context_window * 1000) / 10 : null;
  if (metadata?.deepseek_pricing_model) {
    u.deepseek_cache_hit_tokens = (u.deepseek_cache_hit_tokens || 0) + Number(usage.deepseek_cache_hit_tokens || 0);
    u.deepseek_cache_miss_tokens = (u.deepseek_cache_miss_tokens || 0) + Number(usage.deepseek_cache_miss_tokens || 0);
    if (usage.deepseek_cache_hit_tokens != null && usage.deepseek_cache_miss_tokens != null && usage.output_tokens != null) {
      const cost = deepSeekCost(metadata.deepseek_pricing_model, {
        cache_hit: u.deepseek_cache_hit_tokens,
        cache_miss: u.deepseek_cache_miss_tokens,
        output: u.output_tokens || 0,
      });
      if (cost != null) u.cost = cost;
    }
  } else if (metadata?.pricing && Number.isFinite(u.input_tokens) && Number.isFinite(u.output_tokens)) {
    const billedInput = usage.cost_input_tokens != null && Number.isFinite(Number(usage.cost_input_tokens)) ? Number(usage.cost_input_tokens) : u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;
    u.cost = billedInput * metadata.pricing.input + u.output_tokens * metadata.pricing.output;
  }
}

async function runAnthropic({ key, model, system, history, userText, images, service, message, signal, onProgress, onStep, metadata, mode = "auto", effort = null, chat = {} }) {
  const client = new Anthropic({ apiKey: key, timeout: TURN_SECONDS * 1000, maxRetries: 1 });
  const id = model || CLAUDE_MODELS[0].id;
  const tools = TOOL_SCHEMAS.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(i === TOOL_SCHEMAS.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
  const content = [...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })), { type: "text", text: userText }];
  const messages = [...history, { role: "user", content }];
  // Opus 5.5 and Sonnet 5.5: if a safety check declines, the request is re-run on a fallback model.
  const fallback = /^claude-(opus|sonnet)-5-5$/.test(id);
  for (let step = 0; step < MAX_STEPS; step++) {
    // A message sent while this reply runs, from an app that knows this engine can steer.
    if (chat.steer?.length) {
      const text = chat.steer.splice(0).join("\n\n");
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        if (Array.isArray(last.content)) last.content.push({ type: "text", text });
        else last.content = `${last.content}\n\n${text}`;
      } else messages.push({ role: "user", content: text });
    }
    let stepHasText = false;
    const params = {
      model: id,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      // The user's effort for this engine+model; the provider's default when unset.
      ...(effort ? { output_config: { effort } } : {}),
      // A readable summary of its thinking, for the "what it's doing" list.
      thinking: { type: "adaptive", display: "summarized" },
    };
    const sent = Date.now();
    const stream = fallback
      ? await client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
      : await client.messages.stream(params, { signal });
    let response = null;
    let block = null;
    let stopReason = null;
    let usage = {};
    for await (const ev of stream) {
      if (ev.type === "message_start") {
        usage = { ...usage, ...(ev.message?.usage || {}) };
        response = ev.message;
      } else if (ev.type === "content_block_start") {
        block = ev.content_block ? { ...ev.content_block } : null;
        if (block?.type === "tool_use") {
          block.input = "";
          message.tools.push({ call_id: block.id, tool: block.name, status: "running", started_at: Date.now() });
          onStep(`Using ${block.name}`);
          onProgress();
        }
        if (block?.type === "text") block.text = "";
        if (block?.type === "thinking" && block.thinking?.trim()) onStep(`Thinking: ${block.thinking.trim().replace(/\s+/g, " ").slice(0, 240)}`);
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta") {
          if (block?.type === "text") block.text += ev.delta.text || "";
          const text = ev.delta.text || "";
          if (text && !stepHasText) {
            if (message.text?.trim()) message.text += "\n\n";
            stepHasText = true;
          }
          message.text = (message.text || "") + text;
          onProgress();
        } else if (ev.delta?.type === "input_json_delta" && block) block.input += ev.delta.partial_json || "";
        else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking?.trim()) onStep(`Thinking: ${ev.delta.thinking.trim().replace(/\s+/g, " ").slice(0, 240)}`);
      } else if (ev.type === "content_block_stop" && block) {
        if (block.type === "tool_use") {
          try { block.input = JSON.parse(block.input || "{}"); } catch { block.input = {}; }
        }
        const content = (response ||= { content: [] }).content;
        if (!content[ev.index]) content[ev.index] = block;
        block = null;
      } else if (ev.type === "message_delta") {
        stopReason = ev.delta?.stop_reason || stopReason;
        usage = { ...usage, ...(ev.usage || {}) };
      }
    }
    if (!response) response = { content: [] };
    recordAssistantUsage(message, usage, metadata);
    onProgress();
    onStep(`Claude answered (${Math.round((Date.now() - sent) / 100) / 10} s)`);
    if (stopReason === "refusal") {
      message.text ||= "I can't help with that one.";
      return;
    }
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (!uses.length || stopReason === "end_turn") return;
    if (stopReason === "max_tokens") throw new Error("the reply was cut off");
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const u of uses) {
      const entry = message.tools.find((item) => item.call_id === u.id) || { call_id: u.id, tool: u.name, status: "running" };
      if (!message.tools.includes(entry)) message.tools.push(entry);
      entry.tool = u.name;
      entry.input = trimToolValue(u.input);
      entry.started_at ||= Date.now();
      onProgress();
      const r = callTool(service, u.name, u.input, mode, message);
      if (!r.ok) onStep(`${u.name} failed: ${r.text.slice(0, 160)}`);
      entry.status = r.ok ? "completed" : "error";
      entry.output = trimToolValue(r.text);
      entry.ended_at = Date.now();
      entry.duration_ms = entry.ended_at - entry.started_at;
      const fileCard = r.cards.find((card) => card.kind === "file");
      if (fileCard?.diff) entry.diff = fileCard.diff;
      message.cards = trimCards([...(message.cards || []), ...r.cards]);
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.text, ...(r.ok ? {} : { is_error: true }) });
    }
    onProgress();
    messages.push({ role: "user", content: results });
  }
}

// --- any OpenAI-compatible API ----------------------------------------------------------

async function runOpenAI({ key, base_url, model, system, history, userText, images, service, message, signal, onProgress, onStep, metadata, mode = "auto", effort = null, chat = {} }) {
  if (!model) throw Object.assign(new Error("pick a model in Settings first"), { status: 400 });
  const url = `${(base_url || OPENAI_PRESETS[0].base_url).replace(/\/+$/, "")}/chat/completions`;
  const tools = metadata?.supports_tools === false ? [] : TOOL_SCHEMAS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
  const user = images.length
    ? [{ type: "text", text: userText }, ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))]
    : userText;
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: user }];
  for (let step = 0; step < MAX_STEPS; step++) {
    // A message sent while this reply runs, from an app that knows this engine can steer.
    if (chat.steer?.length) {
      const text = chat.steer.splice(0).join("\n\n");
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        if (Array.isArray(last.content)) last.content.push({ type: "text", text });
        else last.content = `${last.content}\n\n${text}`;
      } else messages.push({ role: "user", content: text });
    }
    let stepHasText = false;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, ...(metadata?.supports_tools === false ? {} : { tools, tool_choice: "auto" }), ...(effort ? { reasoning_effort: effort } : {}), stream: true, stream_options: { include_usage: true } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_SECONDS * 1000)]),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body?.error?.message || `the API said ${res.status}`), { status: res.status, headers: res.headers, body, provider: "openai" });
    }
    if (!res.body) throw new Error("the API sent no reply stream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const callsByIndex = new Map();
    let gotEvent = false;
    const consume = (chunk) => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const packet = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        const data = packet.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        gotEvent = true;
        if (event.error) throw Object.assign(new Error(event.error.message || "the API returned an error"), { status: event.error.status || res.status, headers: res.headers, body: event, provider: "openai" });
        const choice = event.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          if (!stepHasText) {
            if (message.text?.trim()) message.text += "\n\n";
            stepHasText = true;
          }
          content += delta.content;
          message.text = (message.text || "") + delta.content;
          onProgress();
        }
        for (const part of delta?.tool_calls || []) {
          const call = callsByIndex.get(part.index) || { id: "", type: "function", function: { name: "", arguments: "" } };
          if (part.id) call.id = part.id;
          if (part.type) call.type = part.type;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments) call.function.arguments += part.function.arguments;
          if (call.entry && part.id) call.entry.call_id = part.id;
          if (!call.entry && call.function.name) {
            call.entry = { call_id: call.id, tool: call.function.name, status: "running" };
            message.tools.push(call.entry);
            onStep(`Using ${call.function.name}`);
            onProgress();
          } else if (call.entry && part.function?.name) call.entry.tool = call.function.name;
          callsByIndex.set(part.index, call);
        }
        if (event.usage) recordAssistantUsage(message, {
          input_tokens: event.usage.prompt_tokens,
          output_tokens: event.usage.completion_tokens,
          cache_read_input_tokens: event.usage.prompt_tokens_details?.cached_tokens ?? event.usage.prompt_cache_hit_tokens,
          context_input_tokens: event.usage.prompt_tokens,
          cost_input_tokens: event.usage.prompt_tokens,
          deepseek_cache_hit_tokens: event.usage.prompt_cache_hit_tokens,
          deepseek_cache_miss_tokens: event.usage.prompt_cache_miss_tokens,
        }, metadata);
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
      if (buffer.trim()) { const tail = buffer; buffer = ""; consume(`${tail}\n\n`); }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    }
    if (!gotEvent) throw new Error("the API sent no reply");
    const calls = [...callsByIndex.values()];
    if (!calls.length) return;
    messages.push({ role: "assistant", content: content || null, tool_calls: calls.map(({ id, type, function: fn }) => ({ id, type, function: fn })) });
    for (const c of calls) {
      const entry = c.entry || { call_id: c.id, tool: c.function?.name, status: "running" };
      if (!message.tools.includes(entry)) message.tools.push(entry);
      entry.tool = c.function?.name;
      entry.input = trimToolValue(c.function?.arguments);
      entry.started_at ||= Date.now();
      onProgress();
      let args = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch {}
      const r = callTool(service, c.function?.name, args, mode, message);
      entry.status = r.ok ? "completed" : "error";
      entry.output = trimToolValue(r.text);
      entry.ended_at = Date.now();
      entry.duration_ms = entry.ended_at - entry.started_at;
      const fileCard = r.cards.find((card) => card.kind === "file");
      if (fileCard?.diff) entry.diff = fileCard.diff;
      message.cards = trimCards([...(message.cards || []), ...r.cards]);
      messages.push({ role: "tool", tool_call_id: c.id, content: r.text });
    }
    onProgress();
  }
}

export async function listOpenAIModels({ key, base_url }) {
  const cacheKey = createHash("sha256").update(`${base_url || OPENAI_PRESETS[0].base_url}\n${key}`).digest("hex");
  const cached = openaiModelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.models;
  const gemini = apiUrl(base_url) === OPENAI_PRESETS.find((p) => p.id === "gemini").base_url;
  const res = await fetch(gemini ? "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000" : `${apiUrl(base_url)}/models`, {
    headers: gemini ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || `the API said ${res.status}`), { status: res.status, headers: res.headers, body, provider: "openai" });
  const models = (gemini ? (body.models || []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")) : body.data || []).map((m) => {
    const id = String(m.id || m.name).replace(/^models\//, "");
    const context = Number(m.context_length || m.inputTokenLimit);
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    return {
      id,
      name: String(m.displayName || m.name || m.display_name || id),
      context_window: Number.isFinite(context) && context > 0 ? context : null,
      pricing: m.pricing?.prompt != null && m.pricing?.completion != null && Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null,
      efforts: effortsFor("openai", id, base_url),
      ...(isDeepSeekBaseUrl(base_url) ? {
        supports_tools: deepSeekModelSupportsTools(id),
        deepseek_pricing_model: deepSeekModelPricing(id) ? id : null,
        pricing: deepSeekModelPricing(id),
      } : {}),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  openaiModelCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

/** Checks a key before saving it: true, or throws with what is wrong. */
export async function checkKey({ engine, key, base_url }) {
  if (engine === "anthropic") {
    const models = await listAnthropicModels({ key, ...(process.env.HOURGLASS_TEST_HTTP_API === "1" && process.env.ANTHROPIC_BASE_URL ? { base_url: process.env.ANTHROPIC_BASE_URL } : {}) });
    if (!models.length) throw new Error("Anthropic returned no models for this key.");
    return true;
  }
  if (engine === "openai") {
    const models = await listOpenAIModels({ key, base_url });
    if (!models.length) throw new Error("This API returned no models for this key.");
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
  const args = { key, base_url: settings.base_url, model: settings.model, system, history, userText, images, service, message, signal, onProgress, onStep, mode: chat.mode || "auto", effort: settings.effort || null, chat };
  const deepseek = settings.engine === "openai" && isDeepSeekBaseUrl(settings.base_url);
  const provider = deepseek ? "deepseek" : settings.engine;
  let openaiModels = [];
  if (settings.engine === "openai") {
    try { openaiModels = await listOpenAIModels({ key, base_url: settings.base_url }); } catch {}
  }
  const metadataFor = (id) => {
    if (provider === "anthropic") return claudeModels.find((m) => m.id === id);
    const model = openaiModels.find((m) => m.id === id) || {};
    return deepseek ? { ...model, deepseek_pricing_model: model.deepseek_pricing_model } : model;
  };
  const runModel = provider === "anthropic" ? runAnthropic : runOpenAI;
  const tried = new Set();
  let model = settings.model || (provider === "anthropic" ? CLAUDE_MODELS[0].id : "");
  let lastError;
  while (model && !tried.has(model)) {
    tried.add(model);
    args.model = model;
    args.metadata = metadataFor(model);
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
        if (deepseek && Number(e.status || e.statusCode) === 402) e.noModelFallback = true;
        if (message.text?.trim() || message.tools?.length || message.cards?.length) throw e;
        if (normalized.kind !== "network" && normalized.kind !== "overloaded") break;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    if (!failure) return;
    const kind = failure.normalized.kind;
    if (failure.noModelFallback) throw failure;
    if (!["rate_limit", "quota", "overloaded", "network"].includes(kind)) throw failure;
    lastError = failure;
    let alternatives = [];
    if (provider === "anthropic") {
      const ids = claudeModels.map((m) => m.id);
      const index = ids.indexOf(model);
      alternatives = [...ids.slice(index + 1), ...ids.slice(0, Math.max(0, index))];
    } else {
      try {
        const ids = (openaiModels.length ? openaiModels : await listOpenAIModels({ key, base_url: settings.base_url })).map((m) => m.id);
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
