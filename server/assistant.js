// The assistant tab. Common requests ("alarm in 30 minutes", "when is Sara's
// birthday") are answered at once by quick.js, without a model. Everything
// else is handed to opencode (`opencode run`) on its free models, and opencode
// works on that account's data through the Hourglass MCP tools.
//
// A model run costs 6-10 s before the first word (opencode starting, then the
// free model) plus a few seconds per tool call, so every prompt carries what
// the model would otherwise look up: the app guide (assistant-guide.md), and a
// snapshot of the account (today, courses, alarms, timers, own events, recent
// notes, the Drive's top folders). Most questions then need no tool at all.
//
// Attachments: the apps upload to the Drive's "Assistant" folder and send the
// file ids. Each run copies them into the sandbox (uploads/), and pictures go
// to the model itself with `-f`, on a model that can see them.
//
//   HOURGLASS_ASSISTANT         "on" to offer it (default off)
//   HOURGLASS_ASSISTANT_MODELS  tried in order, default opencode/big-pickle,opencode/space-bunny-free
//   HOURGLASS_ASSISTANT_VISION_MODELS  for messages with pictures, default
//                               opencode/mimo-v2.6-flash-free,opencode/space-bunny-free
//   HOURGLASS_ASSISTANT_DIR     one folder per account (default /var/lib/hourglass-assistant/accounts)
//   HOURGLASS_ASSISTANT_RUNNER  "systemd" (default on Linux): every run in its own sandbox
//                               "direct": run the binary as is (development and tests only)
//   HOURGLASS_ASSISTANT_BIN     opencode (default /usr/local/bin/opencode; a .js/.mjs runs under node)
//   HOURGLASS_ASSISTANT_MCP_URL base the MCP link is built on (default HOURGLASS_URL)
//
// Why the sandbox: opencode's free models only answer a stock, unmodified opencode,
// so its own tools (shell, files, web) stay switched on. Anyone signed in writes
// the prompt, so every run happens in a throwaway systemd sandbox, as the
// unprivileged hourglass-ai user, that:
//   - sees only that account's folder - not other accounts, not Hourglass's data,
//     not /root or /opt;
//   - cannot reach anything on this machine's localhost except DNS (Hourglass is
//     reached through its public URL), so other local services are out of reach;
//   - is capped in memory, CPU, processes and time.
// Its config adds only the Hourglass MCP server, with a key that opens that one
// account. The key is the server's own, separate from the user's AI link.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chownSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localParts } from "../core/dates.js";
import { quickAnswer } from "./quick.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");

const MAX_TEXT = 4000;
const PER_HOUR = 60;
const MAX_RUNNING = 3;              // runs at once, across accounts (the droplet has ~2 GB)
const RUN_SECONDS = 240;
const KEEP_MESSAGES = 200;
const SANDBOX_USER = "hourglass-ai";
const MAX_FILES = 6;                // attachments on one message
const ASSISTANT_FOLDER = "Assistant"; // the Drive folder attachments go to

// What the user sees for a tool call: present tense while it runs, past when done.
const TOOL_LABELS = {
  whats_now: ["Checking what's on", "Checked what's on"],
  search: ["Searching", "Searched"],
  move_folder: ["Moving a folder", "Moved a folder"],
  get_schedule: ["Reading the schedule", "Read the schedule"],
  find_events: ["Looking up events", "Looked up events"],
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
  const raw = String(tool || "");
  const name = raw.replace(/^hourglass_/, "");
  // opencode's own tools, if the model reaches for one: say what kind of thing it did.
  const pair = TOOL_LABELS[name] || (raw.startsWith("hourglass_") ? [name.replace(/_/g, " "), name.replace(/_/g, " ")] : ["Working", "Worked"]);
  return status === "completed" ? pair[1] : status === "error" ? `${pair[0]} failed` : pair[0] + "…";
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

/** What the assistant knows about the app itself: every screen, where things are, how-tos. */
function loadGuide(root) {
  try {
    return readFileSync(join(root, "server", "assistant-guide.md"), "utf8").replace(/\r/g, "").trim();
  } catch {
    return "";
  }
}

// The free models only answer stock opencode, so the instructions travel in the
// message itself: in full on a conversation's first message, as a reminder after.
function briefing(skill, guide) {
  return `You are the assistant built into Hourglass, the user's calendar, notes, alarms, timers and Drive app. The user is talking to you from inside the app, and expects an answer within seconds.

Work only through the hourglass tools (hourglass_*). They open this user's own data. Never run bash or any shell command, and do not browse the web or read files - except files in ./uploads/, which are what the user attached to this chat (read them with your read tool when the user asks about them).

How to work, fast:
- Every message ends with a snapshot of the user's data: the time and zone, what is on now and today, courses, alarms, timers, their own events (birthdays, appointments) with next dates, recent notes and Drive folders, with ids. When the snapshot answers the question, answer straight away with no tool at all. When you act, use the ids from it instead of looking them up.
- Use as few tool calls as the task needs. To find something by name (a person, a birthday, a file, an event not in the snapshot) call hourglass_search once: it looks in the calendar first, then notes, Drive and alarms. Birthdays and appointments are calendar events, never look for them in notes first.
- Do what the user asks with the tools, straight away. Do not describe what you would do; do it, then say what you did in one or two short sentences.
- Never say something is done unless the tool call succeeded. If a tool returns an error, say plainly what went wrong.
- Formatting or tidying a note: read it with hourglass_get_notes, then write the whole improved body back with hourglass_update_note. Keep everything the user wrote, including every <span style=...> and <u> tag; only change layout, headings, bullets, to-dos, emphasis and obvious typos.
- An attached file the user wants kept somewhere: it is already in the Drive (its file id is given); move it with hourglass_move_file, or put it in a note as ![name](hgfile:<id>) for a picture or [name](hgfile:<id>) for a file, on a line of its own.
- Ask before deleting a note, removing a course, or removing a whole recurring event. Removing one occurrence needs no confirmation.
- If a request is ambiguous (two courses match, no time given for an alarm), ask one short question.
- When the user asks how to do something in the app, answer from the app guide below in one or two steps.
- Reply in plain text with short sentences. No tables, no code blocks, no headings.

The app:

${guide}

Reference for Hourglass data and its tools:

${skill}`;
}

const REMINDER = "(You are the Hourglass assistant: act only through the hourglass tools, never the shell. Answer from the snapshot below when it answers the question, with no tool; to find anything by name use hourglass_search once (calendar first). Reply in one or two short sentences.)";

/** uid and gid of a system user, from /etc/passwd. null when it does not exist. */
function userIds(name) {
  try {
    const line = readFileSync("/etc/passwd", "utf8").split("\n").find((l) => l.startsWith(name + ":"));
    if (!line) return null;
    const [, , uid, gid] = line.split(":");
    return { uid: +uid, gid: +gid };
  } catch {
    return null;
  }
}

export function createAssistant({ rootDir, publicUrl, registerKey, filePath = () => null, log = console.log }) {
  const enabled = (process.env.HOURGLASS_ASSISTANT || "").toLowerCase() === "on";
  const models = (process.env.HOURGLASS_ASSISTANT_MODELS || "opencode/big-pickle,opencode/space-bunny-free").split(",").map((m) => m.trim()).filter(Boolean);
  const accountsDir = process.env.HOURGLASS_ASSISTANT_DIR || "/var/lib/hourglass-assistant/accounts";
  const runner = process.env.HOURGLASS_ASSISTANT_RUNNER || (process.platform === "linux" ? "systemd" : "direct");
  const bin = process.env.HOURGLASS_ASSISTANT_BIN || "/usr/local/bin/opencode";
  const mcpBase = (process.env.HOURGLASS_ASSISTANT_MCP_URL || publicUrl || "").replace(/\/+$/, "");
  const visionModels = (process.env.HOURGLASS_ASSISTANT_VISION_MODELS || "opencode/mimo-v2.6-flash-free,opencode/space-bunny-free").split(",").map((m) => m.trim()).filter(Boolean);
  const skill = loadSkill(rootDir);
  const guide = loadGuide(rootDir);
  const sandboxIds = runner === "systemd" ? userIds(SANDBOX_USER) : null;
  const usage = new Map();   // email -> [timestamps]
  const running = new Map(); // email -> { child, unit, chat, message }

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

  /** The account's folder: opencode's home and a work folder whose config adds only the Hourglass MCP server. */
  function accountDir(t) {
    const dir = join(accountsDir, sha(t.email || "owner").slice(0, 24));
    const home = join(dir, "home");
    const work = join(dir, "work");
    for (const d of [dir, home, work]) mkdirSync(d, { recursive: true, mode: 0o700 });
    const config = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { hourglass: { type: "remote", url: `${mcpBase}/mcp/${keyOf(t)}`, enabled: true } },
    }, null, 2);
    const file = join(work, "opencode.json");
    if (!existsSync(file) || readFileSync(file, "utf8") !== config) writeFileSync(file, config, { mode: 0o600 });
    // The sandbox runs as hourglass-ai: it owns its account folder and nothing else.
    if (sandboxIds) for (const p of [dir, home, work, file]) chownSync(p, sandboxIds.uid, sandboxIds.gid);
    return { dir, home, work };
  }

  // --- the conversation, kept in the account's own data (the sandbox cannot read it) ---

  const chatFile = (t) => join(t.dir, "assistant_chat.json");
  function loadChat(t) {
    try { return JSON.parse(readFileSync(chatFile(t), "utf8")); } catch { return { session: null, messages: [] }; }
  }
  function saveChat(t, chat) {
    chat.messages = chat.messages.slice(-KEEP_MESSAGES);
    writeFileSync(chatFile(t), JSON.stringify(chat), { mode: 0o600 });
  }

  /**
   * What the model would otherwise look up, in a few hundred words: the time,
   * what is on, courses, alarms, timers, own events, recent notes, the Drive's
   * top level. Each part is skipped if it fails, so a broken row never stops
   * the assistant.
   */
  function context(t) {
    const s = t.service;
    const tz = s.tz || "UTC";
    const now = Date.now();
    const here = localParts(now, tz);
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(new Date(now));
    const parts = [`It is ${weekday} ${here.date}, ${here.time} in ${tz} (the app's time zone; the user reads ${s.settings().time_format === "24h" ? "24-hour" : "12-hour"} times).`];
    const section = (title, fn) => {
      try {
        const lines = fn();
        if (lines && lines.length) parts.push(`${title}:\n${lines.join("\n")}`);
      } catch {}
    };
    section("On now and next", () => {
      const n = s.whatsNow();
      const out = [];
      if (n.active) out.push(`- now: ${n.active.title} ${n.active.start_time}-${n.active.end_time}${n.active.location ? ` in ${n.active.location}` : ""} (event ${n.active.event_id})`);
      if (n.next) out.push(`- next: ${n.next.title} ${n.next.date} ${n.next.start_time}-${n.next.end_time}${n.next.location ? ` in ${n.next.location}` : ""} (event ${n.next.event_id})`);
      if (!out.length) out.push("- nothing on now or in the next 12 hours");
      return out;
    });
    section("Today", () => s.schedule({ from: here.date, to: here.date }).occurrences
      .map((o) => `- ${o.start_time}-${o.end_time} ${o.title}${o.mark ? ` [${o.mark}]` : ""} (event ${o.event_id})`));
    section("Courses", () => s.listCourses().map((c) => `- ${c.name}${c.code ? ` (${c.code})` : ""}: id ${c.id}, ${c.note_count} notes${c.next ? `, next ${c.next.date} ${c.next.start_time}` : ""}`));
    section("The user's own events (not lectures), soonest first", () => {
      const { events, count } = s.findEvents({ personal: true, limit: 30 });
      const lines = events.filter((e) => e.next).map((e) => `- ${e.title}: ${e.repeats}, next ${e.next.date} ${e.next.start_time}-${e.next.end_time} (event ${e.event_id})`);
      if (count > events.length) lines.push(`- (${count - events.length} more: hourglass_search finds them)`);
      return lines;
    });
    section("Alarms", () => s.listAlarms().slice(0, 12).map((a) => {
      const next = a.next_at ? localParts(a.next_at, tz) : null;
      return `- ${a.label}${a.enabled ? "" : " (off)"}: ${a.lead_minutes ? `${a.lead_minutes} min before sessions` : a.days?.length ? `${a.time} on days ${a.days.join(",")}` : `${a.time}${a.date ? ` on ${a.date}` : ""}`}${next ? `, next ${next.date} ${next.time}` : ""} (alarm ${a.id})`;
    }));
    section("Timers", () => s.listTimers().map((x) => `- ${x.label}: ${x.state}, ${x.remaining_s}s left (timer ${x.id})`));
    section("Recent notes", () => s.getNotes({ limit: 8 }).map((n) => `- "${n.title || "Untitled"}"${n.course_name ? ` in ${n.course_name}` : ""}${n.session_date ? ` for ${n.session_date}` : ""} (note ${n.id})`));
    section("Drive (top level)", () => {
      const d = s.listDrive({});
      return [...d.folders.map((f) => `- folder ${f.name}: ${f.items} items (folder ${f.id})`), ...d.files.slice(0, 10).map((f) => `- file ${f.name} (file ${f.id})`)];
    });
    return parts.join("\n\n");
  }

  // Attachments into the sandbox (uploads/), where the model's read tool finds them.
  function stage(t, dirs, files) {
    const dir = join(dirs.work, "uploads");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Only this message's files: the folder is emptied first.
    for (const old of readdirSync(dir)) rmSync(join(dir, old), { force: true, recursive: true });
    const out = [];
    for (const f of files) {
      const src = filePath(t, f.id);
      if (!src || !existsSync(src)) continue;
      const name = `${f.id.slice(0, 8)}-${f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 80)}`;
      copyFileSync(src, join(dir, name));
      out.push({ ...f, path: `uploads/${name}` });
    }
    if (sandboxIds) for (const p of [dir, ...out.map((f) => join(dirs.work, f.path))]) chownSync(p, sandboxIds.uid, sandboxIds.gid);
    return out;
  }

  const isPicture = (f) => /^image\/(png|jpe?g|gif|webp)$/.test(f.mime || "");

  // --- running opencode ---------------------------------------------------------

  function command(dirs, unit, args) {
    const viaNode = /\.m?js$/.test(bin);
    const exe = viaNode ? process.execPath : bin;
    const exeArgs = viaNode ? [bin, ...args] : args;
    if (runner !== "systemd") {
      return { file: exe, args: exeArgs, options: { cwd: dirs.work, env: { ...process.env, HOME: dirs.home } } };
    }
    const p = [
      `User=${SANDBOX_USER}`, `Group=${SANDBOX_USER}`,
      `Environment=HOME=${dirs.home}`, `WorkingDirectory=${dirs.work}`,
      // Only this account's folder exists under /var/lib; /opt and homes are hidden.
      "TemporaryFileSystem=/var/lib", `BindPaths=${dirs.dir}`, `ReadWritePaths=${dirs.dir}`,
      "InaccessiblePaths=-/opt", "ProtectSystem=strict", "ProtectHome=yes", "PrivateTmp=yes", "PrivateDevices=yes",
      "NoNewPrivileges=yes", "ProtectKernelTunables=yes", "ProtectKernelModules=yes", "ProtectControlGroups=yes",
      // Nothing on localhost but DNS: Hourglass is reached through its public URL.
      "IPAddressDeny=localhost", "IPAddressAllow=127.0.0.53",
      "MemoryMax=700M", "CPUQuota=80%", "TasksMax=96", `RuntimeMaxSec=${RUN_SECONDS}`,
    ];
    return { file: "systemd-run", args: ["--quiet", "--wait", "--pipe", `--unit=${unit}`, ...p.flatMap((x) => ["-p", x]), exe, ...exeArgs], options: {} };
  }

  function shapeTool(part) {
    const status = part?.state?.status || "pending";
    return { tool: String(part?.tool || "").replace(/^hourglass_/, ""), status, label: toolLabel(part?.tool, status) };
  }

  /**
   * One `opencode run`, its JSON events folded into `message` as they arrive.
   * Resolves with { error, sessionId, anything } - anything: it said or did something.
   */
  function runOnce(t, dirs, chat, message, prompt, model, unit, attach = []) {
    return new Promise((resolve) => {
      const args = ["run", "--format", "json", "-m", model];
      if (chat.session) args.push("--session", chat.session);
      for (const f of attach) args.push("-f", f);
      const { file, args: cmdArgs, options } = command(dirs, unit, args);
      const child = spawn(file, cmdArgs, { ...options, stdio: ["pipe", "pipe", "pipe"] });
      const entry = running.get(t.email);
      if (entry) Object.assign(entry, { child, unit });
      let buffer = "";
      let stderr = "";
      let error = null;
      let sessionId = null;
      let anything = false;
      let stepText = "";
      const toolsById = new Map();
      const timer = setTimeout(() => stop(t), (RUN_SECONDS + 10) * 1000);

      const onEvent = (ev) => {
        if (ev.sessionID) sessionId = ev.sessionID;
        const part = ev.part || {};
        if (ev.type === "step_start") stepText = "";
        else if (ev.type === "text" && part.text) {
          // The answer is the last step's text; earlier steps may hold text written before a tool call.
          stepText += part.text;
          message.text = stepText.trim();
          anything = true;
        } else if (ev.type === "tool_use") {
          const key = part.callID || part.id || `${toolsById.size}`;
          toolsById.set(key, shapeTool(part));
          message.tools = [...toolsById.values()];
          anything = true;
        } else if (ev.type === "error") {
          error = ev.error?.data?.message || ev.error?.name || "something went wrong";
        }
      };

      child.stdout.on("data", (d) => {
        buffer += d;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          try { onEvent(JSON.parse(line)); } catch {}
        }
      });
      child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
      child.on("error", (e) => { error = `could not start opencode: ${e.message}`; });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (buffer.trim()) { try { onEvent(JSON.parse(buffer)); } catch {} }
        if (!error && !anything) error = code ? `opencode exited (${code})${stderr ? ": " + stderr.trim().slice(-200) : ""}` : "no reply";
        resolve({ error, sessionId, anything });
      });
      child.stdin.end(prompt);
    });
  }

  async function run(t, chat, message, text, fresh, files = []) {
    const dirs = accountDir(t);
    const staged = files.length ? stage(t, dirs, files) : [];
    // Requests the fast lane answered since the last run: the model's conversation lacks them.
    const direct = chat.direct?.length ? `Earlier in this chat the app answered these itself:\n${chat.direct.map((d) => `User: ${d.user}\nApp: ${d.reply}`).join("\n")}\n\n` : "";
    chat.direct = [];
    const attached = staged.length
      ? `\n\nThe user attached (already saved in their Drive's "${ASSISTANT_FOLDER}" folder):\n${staged.map((f) => `- ${f.name} (${f.mime}, file ${f.id}), readable at ./${f.path}${isPicture(f) ? " - also attached to this message, you can see it" : ""}`).join("\n")}`
      : "";
    const prompt = `${fresh ? briefing(skill, guide) + "\n\n" : REMINDER + "\n"}${context(t)}\n\n${direct}The user says:\n${text}${attached}`;
    // Pictures go to the model itself, on a model that can see.
    const pictures = staged.filter(isPicture).map((f) => f.path);
    const order = pictures.length ? visionModels : models;
    const errors = [];
    for (const model of order) {
      const unit = `hourglass-assistant-${sha(t.email || "owner").slice(0, 8)}-${randomBytes(4).toString("hex")}`;
      const r = await runOnce(t, dirs, chat, message, prompt, model, unit, pictures);
      // A run that failed before doing anything leaves no session worth resuming.
      if (r.sessionId && (r.anything || !r.error)) chat.session = r.sessionId;
      if (!running.has(t.email)) { message.error = message.error || "Stopped."; break; } // the user pressed Stop
      if (!r.error) { message.model = model; break; }
      errors.push(`${model}: ${r.error}`);
      // Something already happened on this model: do not run the request twice.
      if (r.anything) { message.error = r.error; break; }
    }
    if (!message.text && !message.tools.length && !message.error) message.error = errors.length ? "The assistant could not answer right now. Try again in a moment." : "No reply.";
    if (errors.length) log(`assistant (${t.email || "owner"}): ${errors.join(" ; ").slice(0, 400)}`);
    saveChat(t, chat);
    running.delete(t.email);
  }

  function stop(t) {
    const r = running.get(t.email);
    if (!r) return;
    running.delete(t.email);
    if (runner === "systemd" && r.unit) spawnSync("systemctl", ["stop", r.unit], { timeout: 10000 });
    try { r.child?.kill("SIGKILL"); } catch {}
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

  const view = (m) => ({ id: m.id, role: m.role, time: m.time, text: m.text || "", tools: m.tools || [], error: m.error || null, files: m.files || [], quick: !!m.quick });

  /** The Drive folder attachments go to, made on first use. */
  function assistantFolder(t) {
    const f = t.store.all("folders").find((x) => !x.parent_id && x.name === ASSISTANT_FOLDER);
    return f || t.service.addFolder({ name: ASSISTANT_FOLDER });
  }

  // The attached Drive files of a message, checked: they must be this account's.
  function attachments(t, ids) {
    const out = [];
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, MAX_FILES)) {
      const f = t.store.get("files", String(id));
      if (f && !f.deleted) out.push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
    }
    return out;
  }

  /** The /api/assistant routes for one account. True when the request was one of them. */
  async function routes(t, req, res, path) {
    if (!path.startsWith("/api/assistant")) return false;
    const m = req.method;
    if (!enabled) {
      if (path === "/api/assistant" && m === "GET") return send(res, 200, { enabled: false, reason: "The assistant isn't set up on the server yet.", messages: [] }), true;
      return send(res, 503, { error: "The assistant isn't set up on the server yet." }), true;
    }

    if (path === "/api/assistant" && m === "GET") {
      const live = running.get(t.email);
      const chat = live ? live.chat : loadChat(t);
      return send(res, 200, { enabled: true, model: models[0], busy: !!live, messages: chat.messages.map(view) }), true;
    }

    // Where the apps upload attachments before sending them (the Drive's "Assistant" folder).
    if (path === "/api/assistant/folder" && m === "GET") {
      return send(res, 200, { folder_id: assistantFolder(t).id, name: ASSISTANT_FOLDER }), true;
    }

    if (path === "/api/assistant/message" && m === "POST") {
      const body = await readJson(req);
      const files = attachments(t, body.files);
      const text = String(body.text || "").trim() || (files.length ? "(see the attached file" + (files.length > 1 ? "s)" : ")") : "");
      if (!text) return send(res, 400, { error: "Write a message first." }), true;
      if (text.length > MAX_TEXT) return send(res, 413, { error: `Keep it under ${MAX_TEXT} characters.` }), true;
      if (running.has(t.email)) return send(res, 409, { error: "Still working on the last message." }), true;
      if (!allow(t.email || "owner")) return send(res, 429, { error: "That's a lot of messages - try again in a while." }), true;
      const chat = loadChat(t);
      const now = Date.now();
      // The fast lane: done here at once, no model.
      const quick = files.length ? null : quickAnswer(t.service, text);
      if (quick) {
        chat.messages.push({ id: `u${now}`, role: "user", time: now, text, tools: [] });
        chat.messages.push({ id: `a${now}`, role: "assistant", time: now, quick: true, text: quick.text, error: null,
          tools: quick.tools.map((x) => ({ tool: x.tool, status: "completed", label: toolLabel(x.tool, "completed") })) });
        // The model hears about it next time, so "make it 9 instead" still makes sense.
        (chat.direct ||= []).push({ user: text, reply: quick.text });
        chat.direct = chat.direct.slice(-6);
        saveChat(t, chat);
        return send(res, 200, { ok: true, quick: true }), true;
      }
      if (running.size >= MAX_RUNNING) return send(res, 503, { error: "The assistant is busy with other people. Try again in a moment." }), true;
      const fresh = !chat.session;
      chat.messages.push({ id: `u${now}`, role: "user", time: now, text, tools: [], files });
      const message = { id: `a${now}`, role: "assistant", time: now, text: "", tools: [], error: null };
      chat.messages.push(message);
      saveChat(t, chat);
      running.set(t.email, { chat, message });
      run(t, chat, message, text, fresh, files).catch((e) => {
        message.error = "Something went wrong.";
        log(`assistant: ${e.stack || e}`);
        saveChat(t, chat);
        running.delete(t.email);
      });
      return send(res, 202, { ok: true }), true;
    }

    if (path === "/api/assistant/stop" && m === "POST") {
      stop(t);
      return send(res, 200, { ok: true }), true;
    }

    // A fresh conversation: the history and opencode's session for it are dropped.
    if (path === "/api/assistant/new" && m === "POST") {
      stop(t);
      saveChat(t, { session: null, messages: [] });
      return send(res, 200, { ok: true }), true;
    }

    return send(res, 404, { error: "not found" }), true;
  }

  if (enabled) log(`assistant: opencode (${models.join(", ")}) via ${runner}, accounts in ${accountsDir}, MCP at ${mcpBase}`);
  else log("assistant: off (set HOURGLASS_ASSISTANT=on to offer it)");
  if (enabled && runner === "systemd" && !sandboxIds) log(`assistant: the ${SANDBOX_USER} user is missing - run server/assistant-setup.sh`);

  return { routes, keyOf, enabled };
}
