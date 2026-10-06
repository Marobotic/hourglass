// The assistant tab: each account talks to opencode on this machine, and opencode
// works on that account's data through the Hourglass MCP tools - nothing else.
//
//   HOURGLASS_ASSISTANT_URL       opencode serve, e.g. http://127.0.0.1:4590 (unset = off)
//   HOURGLASS_ASSISTANT_PASSWORD  its OPENCODE_SERVER_PASSWORD (or <data>/assistant_password)
//   HOURGLASS_ASSISTANT_MODEL     provider/model, e.g. anthropic/claude-sonnet-4-5
//   HOURGLASS_ASSISTANT_DIR       one workspace folder per account (default <data>/assistant)
//
// Why this is safe to offer every account:
//   - opencode is reached only from here, on localhost, with a password.
//   - Each account gets its own workspace. Its config turns every built-in tool
//     off (shell, files, web) and turns on only the hourglass_* MCP tools, which
//     point at this server with a key that opens that one account.
//   - The key is the server's own, separate from the user's AI link: no link has
//     to be made, and deleting one does not break the assistant.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha = (s) => createHash("sha256").update(s).digest("hex");

// Every tool opencode ships with. Off in the config and again on every message.
const BUILTIN_TOOLS = ["bash", "read", "glob", "grep", "edit", "write", "task", "webfetch", "websearch", "todowrite", "todoread", "skill", "apply_patch", "patch", "list", "question", "lsp", "codesearch"];
const OFF = Object.fromEntries(BUILTIN_TOOLS.map((t) => [t, false]));

const MAX_TEXT = 4000;
const PER_HOUR = 60;

// What the user sees for a tool call: present tense while it runs, past when done.
const TOOL_LABELS = {
  whats_now: ["Checking what's on", "Checked what's on"],
  get_schedule: ["Reading the schedule", "Read the schedule"],
  list_courses: ["Reading courses", "Read courses"],
  add_course: ["Adding a course", "Added a course"],
  update_course: ["Updating a course", "Updated a course"],
  remove_course: ["Removing a course", "Removed a course"],
  add_event: ["Adding an event", "Added an event"],
  update_event: ["Updating an event", "Updated an event"],
  remove_event: ["Removing an event", "Removed an event"],
  mark_session: ["Marking attendance", "Marked attendance"],
  get_attendance: ["Reading attendance", "Read attendance"],
  get_notes: ["Reading notes", "Read notes"],
  search_notes: ["Searching notes", "Searched notes"],
  add_note: ["Writing a note", "Wrote a note"],
  append_note: ["Adding to a note", "Added to a note"],
  update_note: ["Editing a note", "Edited a note"],
  delete_note: ["Deleting a note", "Deleted a note"],
  note_versions: ["Reading note history", "Read note history"],
  restore_note_version: ["Restoring a note", "Restored a note"],
  list_drive: ["Reading the Drive", "Read the Drive"],
  move_file: ["Moving a file", "Moved a file"],
  add_folder: ["Making a folder", "Made a folder"],
  remove_folder: ["Removing a folder", "Removed a folder"],
  list_alarms: ["Reading alarms", "Read alarms"],
  set_alarm: ["Setting an alarm", "Set an alarm"],
  set_lecture_reminders: ["Setting reminders", "Set reminders"],
  remove_alarm: ["Removing an alarm", "Removed an alarm"],
  list_ringtones: ["Reading ringtones", "Read ringtones"],
  set_ringtone: ["Choosing a ringtone", "Chose a ringtone"],
  remove_ringtone: ["Removing a ringtone", "Removed a ringtone"],
  world_clock: ["Reading the world clock", "Read the world clock"],
  add_clock: ["Adding a clock", "Added a clock"],
  set_home_zone: ["Changing the time zone", "Changed the time zone"],
  remove_clock: ["Removing a clock", "Removed a clock"],
  list_timers: ["Reading timers", "Read timers"],
  start_timer: ["Starting a timer", "Started a timer"],
  save_timer: ["Saving a timer", "Saved a timer"],
  update_timer: ["Updating a timer", "Updated a timer"],
  stop_timer: ["Stopping a timer", "Stopped a timer"],
};

function toolLabel(tool, status) {
  const name = String(tool || "").replace(/^hourglass_/, "");
  const pair = TOOL_LABELS[name] || [name.replace(/_/g, " "), name.replace(/_/g, " ")];
  return status === "completed" ? pair[1] : status === "error" ? `${pair[0]} failed` : pair[0] + "…";
}

function prompt(skill) {
  return `You are the assistant built into Hourglass, the user's calendar, notes, alarms and timers app. The user is talking to you from inside the app.

You can only act through the hourglass tools. They open this user's own data and nothing else. You have no shell, no files and no web.

How to work:
- Do what the user asks with the tools, straight away. Do not describe what you would do; do it, then say what you did in one or two short sentences.
- Never say something is done unless the tool call succeeded. If a tool returns an error, say plainly what went wrong.
- For anything about now, today or next, start with whats_now. The current date and time are given to you with each message.
- Formatting or tidying a note: read it with get_notes, then write the whole improved body back with update_note. Keep everything the user wrote; only change layout, headings, bullets, emphasis and obvious typos. Notes are Markdown.
- Ask before deleting a note, removing a course, or removing a whole recurring event. Removing one occurrence needs no confirmation.
- If a request is ambiguous (two courses match, no time given for an alarm), ask one short question.
- Reply in plain text with short sentences. No tables, no code blocks, no headings.

What follows is the reference for Hourglass and its tools.

${skill}`;
}

/** The parts of SKILL.md that are about using Hourglass, without the sections on connecting other AIs. */
function loadSkill(root) {
  try {
    const raw = readFileSync(join(root, "skill", "hourglass", "SKILL.md"), "utf8").replace(/\r/g, "");
    return raw.replace(/^---[\s\S]*?---\n/, "").split(/\n## Connecting an AI/)[0].trim();
  } catch {
    return "";
  }
}

export function createAssistant({ dataDir, rootDir, localUrl, registerKey, log = console.log }) {
  const ocUrl = (process.env.HOURGLASS_ASSISTANT_URL || "").replace(/\/+$/, "");
  // The password can live in a root-only file instead of the process environment.
  const pwFile = join(dataDir, "assistant_password");
  const password = process.env.HOURGLASS_ASSISTANT_PASSWORD || (existsSync(pwFile) ? readFileSync(pwFile, "utf8").trim() : "");
  const model = process.env.HOURGLASS_ASSISTANT_MODEL || "";
  const workRoot = process.env.HOURGLASS_ASSISTANT_DIR || join(dataDir, "assistant");
  const systemPrompt = prompt(loadSkill(rootDir));
  const enabled = !!(ocUrl && password && model);
  const usage = new Map(); // email -> [timestamps]

  const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");

  async function oc(path, { method = "GET", body, dir, timeout = 20000 } = {}) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${ocUrl}${path}${sep}directory=${encodeURIComponent(dir)}`, {
      method,
      headers: { authorization: auth, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`assistant: ${r.status} ${text.slice(0, 200)}`), { status: 502 });
    return text ? JSON.parse(text) : null;
  }

  /** The account's assistant key: opens its MCP endpoint, like an AI link the user never sees. */
  function keyOf(t) {
    if (t.assistantKey) return t.assistantKey;
    const f = join(t.dir, "assistant_key");
    let key = existsSync(f) ? readFileSync(f, "utf8").trim() : "";
    if (!key) {
      key = "hg_as_" + randomBytes(24).toString("base64url");
      writeFileSync(f, key + "\n", { mode: 0o600 });
    }
    t.assistantKey = key;
    registerKey(key, t);
    return key;
  }

  /** The account's workspace: an opencode config that allows only the Hourglass tools. */
  function workspace(t) {
    const dir = join(workRoot, sha(t.email || "owner").slice(0, 24));
    // Group-writable: opencode runs as its own user in the folder's group (see assistant-setup.sh).
    mkdirSync(dir, { recursive: true, mode: 0o770 });
    const locked = { "*": false, ...OFF, "hourglass_*": true };
    const permission = { edit: "deny", bash: "deny", webfetch: "deny" };
    const config = {
      $schema: "https://opencode.ai/config.json",
      model,
      share: "disabled",
      autoupdate: false,
      snapshot: false,
      default_agent: "hourglass",
      mcp: { hourglass: { type: "remote", url: `${localUrl}/mcp/${keyOf(t)}`, enabled: true } },
      tools: locked,
      permission,
      agent: {
        hourglass: { mode: "primary", description: "Hourglass assistant", prompt: systemPrompt, tools: locked, permission },
        build: { disable: true },
        plan: { disable: true },
      },
    };
    const file = join(dir, "opencode.json");
    const text = JSON.stringify(config, null, 2);
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text, { mode: 0o640 });
    return dir;
  }

  const sessionFile = (t) => join(t.dir, "assistant_session");
  const sessionOf = (t) => (existsSync(sessionFile(t)) ? readFileSync(sessionFile(t), "utf8").trim() : "");

  async function ensureSession(t, dir) {
    const id = sessionOf(t);
    if (id) {
      try {
        await oc(`/session/${id}`, { dir });
        return id;
      } catch {}
    }
    const s = await oc("/session", { method: "POST", body: { title: "Hourglass" }, dir });
    writeFileSync(sessionFile(t), s.id + "\n", { mode: 0o600 });
    return s.id;
  }

  /** Date, time and zone, sent with every message so "tomorrow" and "at 8" mean the right thing. */
  function context(t) {
    const tz = t.service.tz || "UTC";
    const now = new Date();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
    return `It is ${weekday} ${date}, ${time} in ${tz} (the app's time zone).`;
  }

  /** opencode's messages, flattened to what the chat shows. */
  function shape(list) {
    return (list || []).map(({ info, parts }) => {
      const text = (parts || []).filter((p) => p.type === "text" && !p.synthetic && !p.ignored).map((p) => p.text).join("\n\n").trim();
      const tools = (parts || []).filter((p) => p.type === "tool").map((p) => ({
        tool: String(p.tool || "").replace(/^hourglass_/, ""),
        status: p.state?.status || "pending",
        label: toolLabel(p.tool, p.state?.status),
      }));
      const err = info?.error ? (info.error.data?.message || info.error.name || "something went wrong") : null;
      return { id: info?.id, role: info?.role, time: info?.time?.created || 0, text, tools, error: err };
    }).filter((m) => m.role === "user" ? m.text : (m.text || m.tools.length || m.error));
  }

  function allow(email) {
    const now = Date.now();
    const recent = (usage.get(email) || []).filter((x) => now - x < 3600_000);
    if (recent.length >= PER_HOUR) return false;
    recent.push(now);
    usage.set(email, recent);
    return true;
  }

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  async function readJson(req) {
    let b = "";
    for await (const c of req) {
      b += c;
      if (b.length > MAX_TEXT * 4) throw Object.assign(new Error("message too long"), { status: 413 });
    }
    try { return JSON.parse(b || "{}"); } catch { return {}; }
  }

  /** The /api/assistant routes for one account. True when the request was one of them. */
  async function routes(t, req, res, path) {
    if (!path.startsWith("/api/assistant")) return false;
    const m = req.method;
    if (!enabled) {
      if (path === "/api/assistant" && m === "GET") return send(res, 200, { enabled: false, reason: "The assistant isn't set up on the server yet.", messages: [] }), true;
      return send(res, 503, { error: "The assistant isn't set up on the server yet." }), true;
    }
    const dir = workspace(t);

    if (path === "/api/assistant" && m === "GET") {
      const id = sessionOf(t);
      if (!id) return send(res, 200, { enabled: true, model, busy: false, messages: [] }), true;
      try {
        const [list, status] = await Promise.all([oc(`/session/${id}/message?limit=80`, { dir }), oc("/session/status", { dir })]);
        const st = status?.[id]?.type;
        return send(res, 200, { enabled: true, model, busy: st === "busy" || st === "retry", messages: shape(list) }), true;
      } catch (e) {
        return send(res, 200, { enabled: true, model, busy: false, messages: [], error: "The assistant is not reachable right now." }), true;
      }
    }

    if (path === "/api/assistant/message" && m === "POST") {
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return send(res, 400, { error: "Write a message first." }), true;
      if (text.length > MAX_TEXT) return send(res, 413, { error: `Keep it under ${MAX_TEXT} characters.` }), true;
      if (!allow(t.email || "owner")) return send(res, 429, { error: "That's a lot of messages - try again in a while." }), true;
      const id = await ensureSession(t, dir);
      const status = await oc("/session/status", { dir }).catch(() => ({}));
      if (status?.[id]?.type === "busy") return send(res, 409, { error: "Still working on the last message." }), true;
      await oc(`/session/${id}/prompt_async`, {
        method: "POST",
        dir,
        body: { agent: "hourglass", system: context(t), tools: { ...OFF }, parts: [{ type: "text", text }] },
      });
      return send(res, 202, { ok: true }), true;
    }

    if (path === "/api/assistant/stop" && m === "POST") {
      const id = sessionOf(t);
      if (id) await oc(`/session/${id}/abort`, { method: "POST", dir }).catch(() => {});
      return send(res, 200, { ok: true }), true;
    }

    // A fresh conversation. The old one is deleted, not kept around.
    if (path === "/api/assistant/new" && m === "POST") {
      const id = sessionOf(t);
      if (id) await oc(`/session/${id}`, { method: "DELETE", dir }).catch(() => {});
      writeFileSync(sessionFile(t), "", { mode: 0o600 });
      return send(res, 200, { ok: true }), true;
    }

    return send(res, 404, { error: "not found" }), true;
  }

  if (enabled) log(`assistant: opencode at ${ocUrl}, model ${model}, workspaces in ${workRoot}`);
  else log("assistant: off (set HOURGLASS_ASSISTANT_URL, _PASSWORD and _MODEL to turn it on)");

  return { routes, keyOf, enabled };
}
