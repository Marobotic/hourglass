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
  assert.equal(note.title, "Untitled 01");
  const second = await action("add_note", { course: "algo", body: "more" });
  assert.equal(second.title, "Untitled 02");
  await action("delete_note", { note_id: second.id });
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

test("a birthday is one yearly event, shown every year", async () => {
  const ev = await action("add_event", { title: "Mum's birthday", date: "1970-11-02", start: "09:00", end: "10:00", repeat: { freq: "yearly", days: ["Mon"] } });
  assert.deepEqual(ev.repeat, { freq: "yearly" });            // weekdays only belong to weekly rules
  for (const year of ["2026", "2027", "2040"]) {
    const day = await action("get_schedule", { from: `${year}-11-02`, to: `${year}-11-02` });
    assert.deepEqual(day.occurrences.map((o) => o.title), ["Mum's birthday"]);
  }
  await action("remove_event", { event_id: ev.id, scope: "series" });
});

test("find_events: by any word of the name, at any date, with the next date", async () => {
  const ev = await action("add_event", { title: "Ashwasky's birthday", date: "2027-02-07", start: "09:00", end: "10:00", repeat: { freq: "yearly" } });
  for (const query of ["ashwasky", "Ashwasky's", "ASHWASKY birthdays"]) {
    const r = await action("find_events", { query });
    assert.deepEqual(r.events.map((e) => e.title), ["Ashwasky's birthday"], query);
  }
  const [hit] = (await action("find_events", { query: "ashwasky" })).events;
  assert.equal(hit.repeats, "yearly on 7 Feb");
  assert.equal(hit.next.date, "2027-02-07");
  assert.equal((await action("find_events", { query: "nobody" })).count, 0);
  const all = await action("find_events", {});
  assert.ok(all.events.some((e) => e.course === "Algorithms"));          // lectures too, unless personal
  await action("remove_event", { event_id: ev.id, scope: "series" });
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

test("sync: a note edited on two sides keeps one note and a version, never a copy", async () => {
  const pull = await call("GET", "/api/sync?since=0");
  assert.ok(pull.body.rev > 0);
  const note = pull.body.changes.notes[0];
  // server-side edit after the client pulled
  await action("update_note", { note_id: note.id, body: "server edit" });
  // client pushes its own edit based on the old rev
  const push = await call("POST", "/api/sync", { changes: { notes: [{ ...note, body: "client edit", updated_at: Date.now() + 1000 }] } });
  assert.equal(push.body.conflicts, 1);
  const notes = (await call("GET", "/api/notes")).body;
  assert.deepEqual(notes.map((n) => n.body), ["client edit"]);
  const versions = (await action("note_versions", { note_id: note.id }));
  assert.ok(versions.some((v) => v.body === "server edit" && v.reason === "conflict"), JSON.stringify(versions));
  // Restoring puts the old text back on the same note; the replaced text becomes a version.
  const v = versions.find((x) => x.body === "server edit");
  await action("restore_note_version", { version_id: v.version_id });
  const after = (await call("GET", "/api/notes")).body;
  assert.deepEqual(after.map((n) => n.body), ["server edit"]);
  assert.ok((await action("note_versions", { note_id: note.id })).some((x) => x.body === "client edit"));
});

test("attendance: mark, read, clear", async () => {
  const c = (await call("GET", "/api/courses")).body[0];
  await action("mark_session", { course: c.name, date: "2026-10-06", status: "attended" });
  await action("mark_session", { course: c.name, date: "2026-10-13", status: "absent" });
  await action("mark_session", { course: c.name, date: "2026-10-13", status: "off" });
  const got = (await action("get_attendance", { course: c.name }));
  assert.deepEqual(got.totals, { attended: 1, absent: 0, off: 1 });
  await action("mark_session", { course: c.name, date: "2026-10-13", status: "none" });
  assert.equal((await action("get_attendance", { course: c.name })).marks.length, 1);
  // Marking a cleared day again must stick (it reuses the same row id).
  await action("mark_session", { course: c.name, date: "2026-10-13", status: "attended" });
  assert.deepEqual((await action("get_attendance", { course: c.name })).totals, { attended: 2, absent: 0, off: 0 });
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
  const r = await client.callTool({ name: "search_notes", arguments: { query: "server" } });
  assert.match(r.content[0].text, /server edit/);
  const err = await client.callTool({ name: "get_notes", arguments: { course: "zzz" } });
  assert.equal(err.isError, true);
  await client.close();
});

test("openapi", async () => {
  const spec = await (await fetch(base + "/openapi.json")).json();
  assert.ok(spec.paths["/api/actions/add_course"].post.requestBody);
});

test("world clock: add by city, home zone, day and difference", async () => {
  const cairo = await action("add_clock", { zone: "Africa/Cairo" });
  await action("add_clock", { zone: "tokyo" });
  const again = await action("add_clock", { zone: "Africa/Cairo" });
  assert.equal(again.id, cairo.id); // no duplicates
  store.setMeta("tz", "Africa/Cairo");
  const list = await action("world_clock");
  assert.deepEqual(list.map((c) => c.label), ["Cairo", "Tokyo"]);
  assert.equal(list[0].home, true);
  assert.equal(list[1].diff_min, 6 * 60);
  const bad = await call("POST", "/api/actions/add_clock", { zone: "america" });
  assert.equal(bad.status, 400);
  store.setMeta("tz", TZ);
});

test("world clock: auto-detects timezone and sets first world clock as home", () => {
  const freshStore = new Store(":memory:");
  const freshService = new Service(freshStore, { clock: () => Date.now() });
  assert.equal(freshStore.all("clocks").length, 0);
  const home = freshService.ensureHomeClock("America/Toronto");
  assert.equal(home.zone, "America/Toronto");
  assert.equal(home.label, "Toronto");
  assert.equal(home.home, 1);
  assert.equal(freshService.tz, "America/Toronto");
  const list = freshService.listClocks();
  assert.equal(list.length, 1);
  assert.equal(list[0].zone, "America/Toronto");
  assert.equal(list[0].home, true);
});

test("sync: pushed rows get their rev back, so the next edit is not a conflict", async () => {
  const id = crypto.randomUUID();
  const row = { id, title: "Draft", body: "one", updated_at: Date.now() };
  const first = await call("POST", "/api/sync", { changes: { notes: [row] } });
  const rev = first.body.revs.notes[id];
  assert.ok(rev > 0);
  const second = await call("POST", "/api/sync", { changes: { notes: [{ ...row, body: "two", updated_at: Date.now() + 5, base_rev: rev }] } });
  assert.equal(second.body.conflicts, 0);
});
