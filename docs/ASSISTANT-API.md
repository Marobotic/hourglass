# Hourglass assistant API

The assistant is the in-app AI (the Assistant tab). These routes are the
server side of it: the desktop, Android and iOS clients all talk to the same
endpoints, and an older client that only polls `GET /api/assistant` keeps
working exactly as before.

Everything lives under `/api/assistant`. Requests need the same account
authentication as the rest of the API: `Authorization: Bearer <token>`
(a session from sign-in, the legacy owner token, or an AI link). The server
answers `401` without it and `503 { "error": "The assistant isn't set up on
the server yet." }` when the deployment has it switched off.

Unless stated otherwise, bodies are JSON and responses are JSON.

---

## `GET /api/assistant` — the whole conversation (snapshot)

Poll this for a full picture. It stays the source of truth while a reply is
being written; the stream below is an addition, not a replacement.

```json
{
  "state": "busy",
  "busy": true,
  "queued": 1,
  "enabled": true,
  "engine": "anthropic",
  "engine_name": "Anthropic",
  "base_url": null,
  "model": "claude-haiku-5-5",
  "effort": "medium",
  "mode": "auto",
  "quota": null,
  "queue": [
    { "id": "q1759900000ab12", "at": 1759900000000, "text": "and tomorrow?", "files": 0 }
  ],
  "messages": [
    {
      "id": "u1759899999000ab",
      "role": "user",
      "time": 1759899999000,
      "text": "Plan my morning",
      "tools": [],
      "files": [],
      "quick": false,
      "steer": false,
      "model": null,
      "usage": null,
      "error": null,
      "error_kind": null,
      "error_resets_at": null,
      "cards": [],
      "pending_actions": [],
      "steps": []
    },
    {
      "id": "a1759899999cd34",
      "role": "assistant",
      "time": 1759899999000,
      "text": "Gym alarm set for 7:30.",
      "tools": [
        {
          "call_id": "toolu_01",
          "tool": "set_alarm",
          "label": "Set an alarm",
          "status": "completed",
          "input": "{\"label\":\"Gym\",\"time\":\"07:30\",\"days\":[\"Mon\",\"Wed\"]}",
          "output": "{\"id\":\"al_1\",\"label\":\"Gym\",\"time\":\"07:30\"}",
          "duration_ms": 12,
          "diff": null
        }
      ],
      "files": [],
      "quick": false,
      "steer": false,
      "model": "claude-haiku-5-5",
      "usage": {
        "input_tokens": 1200,
        "output_tokens": 84,
        "cache_read_input_tokens": 900,
        "cache_creation_input_tokens": 0,
        "cost": 0.0031,
        "context_window": 200000,
        "context_percent": 1.1
      },
      "error": null,
      "error_kind": null,
      "error_resets_at": null,
      "cards": [],
      "pending_actions": [],
      "steps": [{ "at": 1759899999500, "text": "Asking claude-haiku-5-5…" }]
    }
  ]
}
```

`state` is `"idle"`, `"busy"` (a reply is running) or `"queued"` (nothing
runs, but messages wait — rare, between turns). `busy` and `queued` remain for
older clients. `effort` is the saved effort for the selected engine+model or
`null`. A message that was steered mid-run has `"steer": true`.

---

## `GET /api/assistant/stream` — live events (Server-Sent Events)

An event stream for the account. Open it once; every run, tools, usage and
state change is pushed as it happens. The first events are `ready`, `state`
and `quota`. A comment line `: ping` arrives every 15 seconds so proxies keep
the connection open. Close the response (or abort the request) to unsubscribe.

```
event: ready
data: {"enabled":true,"engine":"anthropic","model":"claude-haiku-5-5","effort":"medium","state":"idle","busy":false,"queued":0}

event: state
data: {"state":"busy","busy":true,"queued":0}
```

### Events

| event | when | data |
|---|---|---|
| `ready` | once, on subscribe | `enabled`, `engine`, `model`, `effort`, `state`, `busy`, `queued` |
| `state` | a run starts or ends | `state` (`busy`/`idle`/`queued`), `busy`, `queued` |
| `message_start` | a user turn starts (or a fast-lane answer) | `message_id`, `user_message_id`, `at`, `engine`, `model`, `effort`, and `quick: true` for a fast-lane answer |
| `text` | the reply grows | `message_id`, `delta` (the new text), `text` (all of it so far); `replace: true` with `delta: ""` when an engine rewrote its answer (Claude Code's final result) |
| `tool_start` | a tool call begins | tool shape below, `status: "running"` |
| `tool_update` | its input/output changes while running | same shape |
| `tool_end` | it finishes | same shape, `status: "completed"` or `"error"`, `output`, `duration_ms`, and `diff` for file edits |
| `usage` | tokens are known (after each engine step) | `message_id`, `model`, plus every usage field |
| `steer` | a message was delivered into a running direct-engine reply | `message_id`, `user_message_id`, `text` |
| `quota` | a limit starts or clears | `state: "quota"` with `engine`, `kind`, `message`, `resets_at` (epoch ms, may be `null`), `model`; or `state: "ok"` |
| `message_end` | the turn is over | `message_id`, `text`, `error`, `error_kind`, `error_resets_at`, `model`, `usage` |

A tool event looks like this:

```json
{
  "message_id": "a1759899999cd34",
  "id": "toolu_01",
  "tool": "edit_file",
  "label": "Edited a file",
  "status": "completed",
  "input": "{\"file_id\":\"…\",\"old_text\":\"Monday\",\"new_text\":\"Tuesday\"}",
  "output": "{\"id\":\"…\",\"name\":\"week.md\",\"changes\":{\"added\":1,\"removed\":1}}",
  "duration_ms": 18,
  "diff": { "added": 1, "removed": 1, "tooBig": false, "lines": [] }
}
```

Input and output are single strings, trimmed to 2000 characters
(`"… (N more characters)"`), so a phone can render them. `diff` is the same
line diff the file card carries.

---

## `POST /api/assistant/message` — send a message

```json
{ "text": "move my dentist to Friday", "files": ["<drive-file-id>"], "mode": "auto", "steer": false }
```

- `text` (required unless a file is attached), max 4000 characters.
- `files` (optional): Drive file ids already uploaded to the Assistant folder.
- `mode` (optional): `ask`, `auto`, `dangerous` or `plan`.
- `steer` (optional): when a direct engine (`anthropic`/`openai`) is running,
  deliver this message into it between steps instead of queueing.

Responses:

| status | body | meaning |
|---|---|---|
| `200` | `{ "ok": true, "quick": true }` | answered at once by the fast lane (timers, alarms, common requests), no model |
| `202` | `{ "ok": true }` | a model run started |
| `202` | `{ "ok": true, "queued": true, "id": "q…", "position": 1 }` | a run was busy: this message waits and runs next |
| `202` | `{ "ok": true, "steer": true, "user_message_id": "u…" }` | delivered into the running reply |
| `400` | `{ "error": "Write a message first." }` | empty text |
| `413` | `{ "error": "Keep it under 4000 characters." }` | too long |
| `429` | `{ "error": "…", "resets_at": 1759903600000, "limit": "messages_per_hour" }` | the account's 60 messages/hour cap, or 10 already queued |
| `503` | `{ "error": "The assistant is busy with other people. …" }` | three runs are already active across accounts |

A message sent while a run is busy is **queued instead of refused**;
old clients that treated `409` as "wait and retry" now get a `202` with
`queued: true` and keep polling. Queueing is only used by the CLI engines
(`free`, `claude`); `anthropic`/`openai` also accept `steer: true`.

---

## `DELETE /api/assistant/queue/:id` — cancel a queued message

`id` is the one returned by `POST /api/assistant/message`.

```json
{ "ok": true, "cancelled": "q1759900000ab12" }
```

`404 { "error": "queued message not found" }` when it already started or was
cancelled. `POST` works too, for clients that cannot send `DELETE`.

---

## `POST /api/assistant/retry` — retry the last reply

Optional body: `{ "message_id": "a…" }` (defaults to the newest assistant
message). The last user message is replayed; nothing else follows it.

```json
{ "ok": true, "retried": "Plan my morning" }
```

`409` while a run is active, `404` when there is nothing to retry. The turn
starts a fresh model conversation, so a broken session cannot poison the retry.

---

## `POST /api/assistant/edit` — edit a user message and rerun

```json
{ "message_id": "u…", "text": "move my dentist to Thursday", "files": ["<drive-file-id>"] }
```

`message_id` defaults to the newest user message; `files` defaults to the
message's existing attachments. Everything after the message is dropped, the
text is replaced and the turn runs again. Returns `202 { "ok": true }` (or
`400`/`404`/`409` like retry). This is how an app offers "edit and resend".

---

## `POST /api/assistant/undo` — undo the last Drive file change

The assistant's Drive changes keep the previous bytes as a file version
(`server/versions.js`, 20 per file). This restores the newest changed file from
the newest assistant turn; a file the turn created is removed.

```json
{ "ok": true, "action": "restored", "file_id": "3f2…", "name": "week.md", "message_id": "a…", "restored_from": "9c1…" }
```

`action` is `"restored"` or `"deleted"`. The card's state becomes `"undone"`,
so a second call moves to the next change; `404 { "error": "There is no
assistant Drive change to undo." }` when none is left. `409` while a run is
active. Note: restoring itself keeps the undone content as a version, so
nothing is lost.

---

## `POST /api/assistant/mode` — permission mode

```json
{ "mode": "plan" }
```

`ask` (propose every change, wait for Apply), `auto` (risky tools wait),
`dangerous` (everything applies at once), and **`plan`**: read-only tools run,
every tool that writes is refused by the server — no proposal is created and
no change happens, in every engine (`free`, `claude`, `anthropic`, `openai`).

```json
{ "mode": "plan" }
```

`400 { "error": "mode must be ask, auto, dangerous or plan" }` otherwise.

---

## `GET/POST /api/assistant/settings` — engine, model, key, effort

`GET` returns the saved engine, its model, the effort, every model with the
efforts it supports, and whether a key is saved (keys never come back).

```json
{
  "engine": "anthropic",
  "engine_name": "Anthropic",
  "model": "claude-haiku-5-5",
  "effort": "medium",
  "efforts": { "anthropic": { "claude-haiku-5-5": "medium" } },
  "models": { "anthropic": "claude-haiku-5-5" },
  "base_url": null,
  "has_key": { "anthropic": true },
  "engines": [{ "id": "free", "name": "Free", "note": "…" }],
  "free_models": [{ "id": "opencode/big-pickle", "name": "big-pickle", "source": "discovered", "efforts": ["low", "medium", "high"] }],
  "free_model_discovery": { "status": "discovered", "configured": ["opencode/big-pickle"] },
  "claude_models": [{ "id": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "context_window": 200000, "pricing": { "input": 0.000001, "output": 0.000005 }, "efforts": ["low", "medium", "high"] }],
  "claude_model_source": "live",
  "claude_ready": true,
  "presets": [{ "id": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1" }]
}
```

`POST` saves a change (a missing field is left as is):

```json
{ "engine": "anthropic", "model": "claude-haiku-5-5", "key": "sk-ant-…", "effort": "high" }
```

- Effort is stored **per engine and model** (`efforts[engine slot][model]`),
  so switching back restores it. It is `low`, `medium` or `high`; each model
  lists what it supports in `efforts` (`[]` when it cannot take one, e.g.
  DeepSeek). A model that cannot take one answers
  `400 { "error": "This model does not take an effort setting." }`.
- Effort travels to the provider as `output_config.effort` (Anthropic),
  `reasoning_effort` (OpenAI-compatible) or the model variant
  `provider/model#effort` (opencode). Unset means the provider's default.
- A key is checked before it is saved (`400` with the reason), sealed with the
  server's key and never returned.

---

## `GET /api/assistant/models` — the models an engine offers

`?engine=free|claude|anthropic|openai&base_url=<https://…>`

```json
{ "models": [ { "id": "gpt-test", "name": "Display gpt-test", "context_window": 128000, "pricing": { "input": 0.000002, "output": 0.000008 }, "efforts": ["low", "medium", "high"] } ] }
```

A missing key answers `200 { "models": [], "error": "Add a key for this API first." }`.

---

## `GET /api/assistant/usage` — what it costs, what is left

`?days=30` (1–90). Per day (UTC, oldest first, empty days included), per
engine, the live context meter and any limit in force.

```json
{
  "engine": "anthropic",
  "engine_name": "Anthropic",
  "model": "claude-haiku-5-5",
  "effort": "medium",
  "effort_options": ["low", "medium", "high"],
  "limits": { "messages_per_hour": 60, "max_running": 3, "max_queued": 10, "plan": null },
  "context": {
    "window": 200000,
    "percent": 1.1,
    "input_tokens": 1200,
    "output_tokens": 84,
    "cache_read_input_tokens": 900,
    "cache_creation_input_tokens": 0
  },
  "today": { "date": "2026-11-08", "runs": 4, "input_tokens": 2200, "output_tokens": 140, "tokens": 2340, "cost": 0.004, "unpriced_runs": 0 },
  "days": [ { "date": "2026-11-08", "runs": 4, "input_tokens": 2200, "output_tokens": 140, "cache_read_input_tokens": 900, "cache_creation_input_tokens": 0, "tokens": 2340, "cost": 0.004, "unpriced_runs": 0 } ],
  "engines": [ { "engine": "anthropic", "runs": 4, "input_tokens": 2200, "output_tokens": 140, "tokens": 2340, "cost": 0.004, "unpriced_runs": 0, "models": ["claude-haiku-5-5"] } ],
  "totals": { "runs": 4, "input_tokens": 2200, "output_tokens": 140, "tokens": 2340, "cost": 0.004, "unpriced_runs": 0 },
  "quota": null,
  "quotas": [],
  "deepseek": { "peak": false, "peak_until": null, "line": "Off-peak: half price" }
}
```

- `cost` is `null`/absent when the provider's price is unknown; `unpriced_runs`
  counts those turns. DeepSeek prices follow its peak/off-peak clock.
- `limits.plan` is `"Claude Pro/Max"` on the Claude subscription engine; other
  plans are not reported by their providers.
- `context` comes from the newest message that has usage. `percent` is the
  input (including cache) over the model's context window.
- `deepseek` is the same state as `GET /api/assistant/deepseek-pricing`.
- Usage is kept in `assistant_usage.jsonl` in the account's data folder, one
  line per model turn, pruned to 90 days / 5000 turns.

---

## `GET /api/assistant/deepseek-pricing` — DeepSeek's peak window

```json
{ "peak": true, "peak_until": "10:00 UTC", "line": "Peak price until 10:00 UTC" }
```

(Unchanged; Weekdays 01–04 and 06–10 UTC are peak, otherwise half price.)

---

## `POST /api/assistant/actions/:id/apply` and `…/skip`

Applies or drops a proposal from `ask`/`auto` mode. `apply` returns
`{ "ok": true, "status": "applied", "result": { … }, "cards": [ … ] }`; `skip`
returns `{ "ok": true, "status": "skipped" }`; a proposal that is no longer
pending answers `404`. Plan mode never creates proposals.

---

## Attachments and other routes

- `GET /api/assistant/folder` → `{ "folder_id": "…", "name": "Assistant" }`:
  the Drive folder the apps upload files to before sending their ids.
- `POST /api/assistant/stop` → `{ "ok": true }`: stops the run and drops the
  queue.
- `POST /api/assistant/new` → `{ "ok": true }`: stops, empties the
  conversation, resets the mode to `auto` and the opencode session.
- Claude subscription sign-in: `POST /api/assistant/claude/login` →
  `{ "url": "https://claude.com/…" }`, `GET …/login/status` →
  `{ "state": "waiting_code" | "checking" | "connected" | "error", "message": "…" }`,
  `POST …/login/code` with `{ "code": "…" }` (add `"async": true` for
  `202 { "state": "connecting" }`), `POST …/login/cancel`.

---

## Client recipe

1. Open the stream; keep `GET /api/assistant` for the first paint and a full
   refresh after reconnecting (the stream does not replay history).
2. On `message_start`, add the user and assistant messages.
3. Append `text.delta` (or replace `text.text` when `replace` is true) and
   update the tool list from `tool_start`/`tool_update`/`tool_end`.
4. Show `state` as the busy/idle pill, `usage` as the context meter, and
   `quota` as a banner with its reset time until `state: "ok"`.
5. A message sent while busy is `queued`; show it greyed with a cancel
   (`DELETE /api/assistant/queue/:id`). On direct engines, a "steer" button
   posts the same text with `steer: true`.
6. Retry / Edit / Undo are the three buttons under the last assistant turn.
