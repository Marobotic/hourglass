// Live events for the assistant tab (assistant.js). The app can keep polling
// GET /api/assistant for the whole conversation, or subscribe to
// GET /api/assistant/stream and draw the reply as it is written: text deltas,
// tool start/update/end, usage and the busy/idle/queued state.
//
// This module holds the wire pieces only, so they can be tested without a
// server: the event hub (one set of subscribers per account), a mirror that
// turns a message object into events by watching it, and the trimming that
// keeps tool input/output small enough for a phone.
const DEFAULT_MAX = 2000;

/** A tool's input or output as one short string: JSON when it is an object. */
export function trimToolValue(value, max = DEFAULT_MAX) {
  if (value === undefined || value === null) return null;
  let text;
  if (typeof value === "string") text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (${text.length - max} more characters)`;
}

/** The part of a tool call the apps show: its name, state, input, output, time and diff. */
export function toolEvent(messageId, tool, extra = {}) {
  return {
    message_id: messageId,
    id: tool.call_id || tool.id || tool.tool || "tool",
    tool: tool.tool || "",
    label: tool.label || null,
    status: tool.status || "running",
    input: trimToolValue(tool.input),
    output: trimToolValue(tool.output),
    duration_ms: Number.isFinite(tool.duration_ms) ? tool.duration_ms : null,
    diff: tool.diff || null,
    ...extra,
  };
}

function writeEvent(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}

/**
 * One subscriber set per account. Every write goes to every open stream of
 * that account; a closed stream is dropped on the next write. A comment line
 * every `heartbeatMs` keeps proxies from closing an idle stream.
 */
export function createEventHub({ heartbeatMs = 15000 } = {}) {
  const subscribers = new Map(); // account key -> Set<{ res, timer }>
  const drop = (key, sub) => {
    clearInterval(sub.timer);
    const set = subscribers.get(key);
    if (!set) return;
    set.delete(sub);
    if (!set.size) subscribers.delete(key);
  };
  return {
    subscribe(key, res) {
      const sub = { res, timer: setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, heartbeatMs) };
      sub.timer.unref?.();
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(sub);
      const close = () => drop(key, sub);
      res.on?.("close", close);
      res.on?.("error", close);
      return close;
    },
    emit(key, event, data = {}) {
      const set = subscribers.get(key);
      if (!set) return 0;
      for (const sub of [...set]) {
        try { sub.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
        catch { drop(key, sub); }
      }
      return set.size;
    },
    count(key) { return subscribers.get(key)?.size || 0; },
    close(key) {
      for (const sub of [...(subscribers.get(key) || [])]) drop(key, sub);
    },
    closeAll() { for (const key of [...subscribers.keys()]) this.close(key); },
    write: writeEvent,
  };
}

/**
 * Watches one assistant message while its engine fills it in, and emits only
 * what changed: text deltas, tool phases, usage and a final message_end.
 * `emit(event, data)` is the hub's method with the account already applied.
 */
export function createStreamMirror({ message, emit, now = () => Date.now() }) {
  const messageId = () => message.id || null;
  let sentText = "";
  let sentUsage = null;
  const seenTools = new Map(); // key -> { at, status, input, output }

  function sync() {
    const text = message.text || "";
    if (text !== sentText) {
      if (text.startsWith(sentText)) {
        emit("text", { message_id: messageId(), delta: text.slice(sentText.length), text });
      } else {
        // An engine replaced its answer (Claude Code's final result): send the whole text.
        emit("text", { message_id: messageId(), delta: "", text, replace: true });
      }
      sentText = text;
    }

    const tools = message.tools || [];
    const live = new Set();
    tools.forEach((tool, index) => {
      const key = String(tool.call_id || tool.id || `${tool.tool || "tool"}:${index}`);
      live.add(key);
      const prior = seenTools.get(key);
      const status = tool.status || "running";
      if (!prior) {
        const entry = { at: now(), status, input: tool.input, output: tool.output, tool: tool.tool, label: tool.label };
        seenTools.set(key, entry);
        emit("tool_start", toolEvent(messageId(), { ...tool, status }));
        if (status === "completed" || status === "error") {
          const duration_ms = entry.at ? now() - entry.at : null;
          emit("tool_end", toolEvent(messageId(), { ...tool, duration_ms }));
          entry.status = status;
        }
        return;
      }
      if (prior.status !== status) {
        prior.status = status;
        if (status === "completed" || status === "error") {
          const duration_ms = Number.isFinite(tool.duration_ms) ? tool.duration_ms : now() - prior.at;
          emit("tool_end", toolEvent(messageId(), { ...tool, status, duration_ms }));
        } else {
          emit("tool_update", toolEvent(messageId(), { ...tool, status }));
        }
      } else if (prior.input !== tool.input || prior.output !== tool.output) {
        prior.input = tool.input;
        prior.output = tool.output;
        emit("tool_update", toolEvent(messageId(), { ...tool, status }));
      }
    });
    // A tool an engine dropped (a retried model call) ends as cancelled.
    for (const [key, prior] of seenTools) {
      if (live.has(key) || prior.status === "completed" || prior.status === "error") continue;
      prior.status = "cancelled";
      emit("tool_end", toolEvent(messageId(), { id: key, tool: prior.tool, label: prior.label, status: "cancelled" }));
    }

    if (message.usage) {
      const serialised = JSON.stringify(message.usage);
      if (serialised !== sentUsage) {
        sentUsage = serialised;
        emit("usage", { message_id: messageId(), model: message.model || null, ...message.usage });
      }
    }
  }

  function end() {
    sync();
    emit("message_end", {
      message_id: messageId(),
      text: message.text || "",
      error: message.error || null,
      error_kind: message.error_kind || null,
      error_resets_at: message.error_resets_at || null,
      model: message.model || null,
      usage: message.usage || null,
    });
  }

  return { sync, end };
}
