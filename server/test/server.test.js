import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Store } from "../../core/node/store.js";
import { Service } from "../../core/node/service.js";
import { zonedToEpoch } from "../../core/index.js";
import { createHandler } from "../app.js";

const TZ = "Europe/London";
let clockMs = zonedToEpoch("2026-09-29", "08:30", TZ); // Tuesday, mid-lecture
const store = new Store(":memory:");
store.setMeta("tz", TZ);
const service = new Service(store, { clock: () => clockMs });
const token = "t0k";
let base, server;

before(async () => {
  server = createServer(createHandler({ store, service, token, icalToken: "ik" }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body, tok = token) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() };
};
const action = async (name, args) => {
  const r = await call("POST", `/api/actions/${name}`, args);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

test("auth", async () => {
  assert.equal((await call("GET", "/api/now", null, "nope")).status, 401);
  assert.equal((await fetch(base + "/health")).status, 200);
});

test("course with schedule, then now surfaces the session", async () => {
  const { course, events } = await action("add_course", {
    name: "Algorithms", code: "CS201", location: "Room 4",
    schedule: [{ day: "Tue", start: "08:00", end: "10:00" }, { day: "thursday", start: "14:00", end: "15:00", kind: "lab" }],
    term_start: "2026-09-01", term_end: "2026-12-12",
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].start_date, "2026-09-01");
  assert.equal(events[1].start_date, "2026-09-03");
  const note = await action("add_note", { course: "algo", body: "Big-O recap" });
  assert.equal(note.session_date, "2026-09-29");
  assert.equal(note.title, "Tue 29 Sep");
  const now = await action("whats_now");
  assert.equal(now.active.title, "Algorithms");
  assert.equal(now.active.state, "live");
  assert.deepEqual(now.notes.session.map((n) => n.id), [note.id]);
  assert.equal(course.color, "#B14242");
});

test("remove one occurrence vs series; errors are 400", async () => {
  const [lecture] = (await action("list_courses"))[0].events;
  await action("remove_event", { event_id: lecture.id, scope: "occurrence", date: "2026-10-06" });
  const week = await action("get_schedule", { from: "2026-10-05", to: "2026-10-11" });
  assert.deepEqual(week.occurrences.map((o) => o.kind), ["lab"]);
  const bad = await call("POST", "/api/actions/add_note", { course: "Nonexistent" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no course called/);
  const invalid = await call("POST", "/api/actions/add_event", { start: "8am" });
  assert.equal(invalid.status, 400);
});

test("alarms and timers", async () => {
  const a = await action("set_alarm", { before: "Algorithms", minutes_before: 15 });
  assert.equal(a.label, "Algorithms in 15 min");
  const list = await action("list_alarms");
  assert.equal(list[0].next_at, zonedToEpoch("2026-10-01", "13:45", TZ)); // Thursday lab 14:00, the next session after Tue 08:30
  const t = await action("start_timer", { minutes: 25, label: "Focus" });
  assert.equal(t.ends_at, clockMs + 25 * 60000);
  clockMs += 60000;
  const p = await action("update_timer", { timer_id: t.id, action: "pause" });
  assert.equal(p.remaining_s, 24 * 60);
});

test("sync: pull, push, note conflict copy", async () => {
  const pull = await call("GET", "/api/sync?since=0");
  assert.ok(pull.body.rev > 0);
  const note = pull.body.changes.notes[0];
  // server-side edit after the client pulled
  await action("update_note", { note_id: note.id, body: "server edit" });
  // client pushes its own edit based on the old rev
  const push = await call("POST", "/api/sync", { changes: { notes: [{ ...note, body: "client edit", updated_at: Date.now() + 1000 }] } });
  assert.equal(push.body.conflicts, 1);
  const notes = (await call("GET", "/api/notes")).body;
  assert.deepEqual(notes.map((n) => n.body).sort(), ["client edit", "server edit"]);
  assert.ok(notes.some((n) => n.title.endsWith("(conflict copy)")));
});

test("ical feed", async () => {
  assert.equal((await fetch(base + "/ical?key=wrong")).status, 403);
  const text = await (await fetch(base + "/ical?key=ik")).text();
  assert.match(text, /RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261212T235959/);
  assert.match(text, /EXDATE;TZID=Europe\/London:20261006T080000/);
});

test("MCP: tools list and call", async () => {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 20);
  assert.ok(tools.find((t) => t.name === "remove_event").annotations.destructiveHint);
  const r = await client.callTool({ name: "search_notes", arguments: { query: "client" } });
  assert.match(r.content[0].text, /client edit/);
  const err = await client.callTool({ name: "get_notes", arguments: { course: "zzz" } });
  assert.equal(err.isError, true);
  await client.close();
});

test("openapi", async () => {
  const spec = await (await fetch(base + "/openapi.json")).json();
  assert.ok(spec.paths["/api/actions/add_course"].post.requestBody);
});
