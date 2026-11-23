// The 2026-11-23 incident, replayed against the real server pieces.
//
// 07:36 Cairo: "you can skip my alarm for today only". The model had no skip,
// so it turned the lecture alarm off for good (set_alarms_enabled false) and
// said it was done. 07:45: the iPhone, last synced before that, rang the alarm
// anyway (AlarmKit had it scheduled). Its Snooze asked /api/ring/state, which
// only knew stops posted since the server started, answered "not stopped", and
// the 5-minute snooze timer was made. 07:50: that shared timer rang on the
// iPhone, Windows and both Android phones at once.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Store } from "../../core/node/store.js";
import { Service } from "../../core/node/service.js";
import { dueBetween, nextAlarm, snoozeTimerId, zonedToEpoch } from "../../core/index.js";
import { createHandler } from "../app.js";
import { createRingRoutes } from "../ring.js";
import { quickAnswer } from "../quick.js";
import { INSTRUCTIONS, runTool, toolByName } from "../tools.js";

const TZ = "Africa/Cairo";
const at = (d, t) => zonedToEpoch(d, t, TZ);
const RING = at("2026-11-23", "07:45"); // 45 min before the 08:30 lecture
const token = "t0k";

// The account as it was: a Monday lecture with a 45-minute alarm (the one that
// rang) and a Tuesday one with a 30-minute alarm (must not be touched).
function account(now = "07:36") {
  let clock = at("2026-11-23", now);
  const store = new Store(":memory:");
  store.setMeta("tz", TZ);
  const service = new Service(store, { clock: () => clock });
  store.upsert("courses", { id: "cagd", name: "Computer-Aided Graphic Design (1)" });
  store.upsert("courses", { id: "print", name: "Printmaking Techniques (1)" });
  store.upsert("events", { id: "cagd-lec", course_id: "cagd", kind: "lecture", start_date: "2026-11-02", start_time: "08:30", end_time: "10:30", repeat: { freq: "weekly", days: [1] }, tz: TZ });
  store.upsert("events", { id: "print-lec", course_id: "print", kind: "lecture", start_date: "2026-11-03", start_time: "08:30", end_time: "10:30", repeat: { freq: "weekly", days: [2] }, tz: TZ });
  store.upsert("alarms", { id: "a-cagd", label: "Alarm", lead_event_id: "cagd-lec", lead_minutes: 45, enabled: 1 });
  store.upsert("alarms", { id: "a-print", label: "Alarm", lead_event_id: "print-lec", lead_minutes: 30, enabled: 1 });
  return { store, service, set: (t) => (clock = at("2026-11-23", t)) };
}

// One server process for an account; `restart` builds a fresh one on the same
// data, as after a deploy or a crash (the in-memory stop maps are empty).
async function serve(store, service) {
  const t = { store, service };
  const route = createRingRoutes(t);
  const server = createServer(createHandler({ store, service, token, icalToken: "ik", extra: route, guard: t.ringGuard }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, device = "iPhone") => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-hourglass-device": device }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}
const servers = [];
async function open(store, service) {
  const s = await serve(store, service);
  servers.push(s);
  return s;
}
after(async () => { for (const s of servers) await s.close(); });

const state = (call, id, when, device) => call("GET", `/api/ring/state?alarm_id=${id}&at=${when}`, null, device);
const pushSnoozeTimer = (call, alarmId, when, device = "iPhone") =>
  call("POST", "/api/sync", { changes: { timers: [{ id: snoozeTimerId(alarmId, when), label: "Computer-Aided Graphic Design (1) in 45 min (snoozed)", duration_s: 300, state: "running", ends_at: when + 303_669, updated_at: Date.now() }] } }, device);

// --- bug 1: "skip my alarm today" -------------------------------------------------------

test("the exact 2026-11-23 words skip one ring: the alarm stays on, next week's ring stays", async () => {
  const { store, service } = account("07:36");
  const r = quickAnswer(service, "you can skip my alarm for today only");
  assert.ok(r, "answered by the fast lane, not left to a model");
  assert.deepEqual(r.tools, [{ tool: "skip_alarm", status: "completed" }]);
  assert.match(r.text, /Skipped .*7:45 AM today, just that once: it stays on/);
  const a = store.get("alarms", "a-cagd");
  assert.equal(a.enabled, 1, "not turned off for good");
  assert.equal(store.get("alarms", "a-print").enabled, 1);
  // Every device's schedule passes over the skipped ring and keeps the next one.
  assert.equal(nextAlarm(a, service.data(), service.clock(), TZ), at("2026-11-30", "07:45"));
  assert.deepEqual(dueBetween(service.data(), service.clock(), at("2026-11-23", "08:00"), TZ), []);
  assert.equal(service.listAlarms().find((x) => x.id === "a-cagd").skipped_at, RING);
  // A phone that has not synced and rings it anyway is told it is stopped.
  const { call } = await open(store, service);
  const s = await state(call, "a-cagd", RING);
  assert.equal(s.body.stopped?.action, "dismissed");
  assert.equal(s.body.stopped?.skipped, true);
});

test("\"i'm awake cancel alarm today\" (2026-11-22) is a skip too, never a turn-off", () => {
  const { store, service } = account("06:30");
  const r = quickAnswer(service, "i’m awake cancel alarm today");
  assert.equal(r?.tools?.[0]?.tool, "skip_alarm");
  assert.equal(store.get("alarms", "a-cagd").enabled, 1);
});

test("skip_alarm fails, and says so, when there is nothing to skip", () => {
  const { service, set } = account("07:50"); // today's ring is over
  assert.throws(() => runTool(service, "skip_alarm", { alarm_id: "a-cagd" }), /no ring left on today/);
  set("07:00");
  runTool(service, "set_alarm", { alarm_id: "a-cagd", enabled: false });
  assert.throws(() => runTool(service, "skip_alarm", { alarm_id: "a-cagd" }), /turned off/);
});

test("skip_alarm undo brings the ring back", () => {
  const { store, service } = account("07:00");
  runTool(service, "skip_alarm", { alarm_id: "a-cagd" });
  assert.equal(nextAlarm(store.get("alarms", "a-cagd"), service.data(), service.clock(), TZ), at("2026-11-30", "07:45"));
  runTool(service, "skip_alarm", { alarm_id: "a-cagd", undo: true });
  assert.equal(nextAlarm(store.get("alarms", "a-cagd"), service.data(), service.clock(), TZ), RING);
});

test("the model is told what \"today only\" means and has the tool to do it", () => {
  assert.ok(toolByName.get("skip_alarm"), "skip_alarm is a tool (MCP, REST and the in-app assistant)");
  assert.equal(toolByName.get("skip_alarm").permission, "change");
  assert.match(INSTRUCTIONS, /today only.*skip_alarm/s);
  assert.match(INSTRUCTIONS, /only when the tool returned without an error/);
  assert.match(toolByName.get("set_alarms_enabled").description, /Not for one day/);
});

test("a complaint about the alarm is not answered with the alarm list", () => {
  const { service } = account("07:51");
  assert.equal(quickAnswer(service, "my alarm rang anyway...? and on my phone TWICE...?"), null);
});

// --- bug 2: the second ring --------------------------------------------------------------

test("incident replay: alarm turned off, a stale iPhone rings it and snoozes: nothing rings again", async () => {
  const { store, service, set } = account("07:36");
  const { call } = await open(store, service);
  runTool(service, "set_alarms_enabled", { alarm_ids: ["a-cagd"], enabled: false }); // what the model did
  set("07:45");
  // RingSnoozeIntent on the iPhone: state first. It used to answer null.
  const s = await state(call, "a-cagd", RING);
  assert.ok(s.body.stopped, "an alarm that is off is stopped, so the iPhone does not snooze");
  assert.equal(s.body.stopped.reason, "off");
  // An older app snoozes regardless: the server does not take it as a snooze.
  const stop = await call("POST", "/api/ring/stop", { alarm_id: "a-cagd", at: RING, action: "snoozed", device: "iPhone" });
  assert.equal(stop.body.snoozed, false);
  assert.equal(JSON.parse(store.get("prefs", "ring_stop:a-cagd").value).action, "dismissed");
  // ...and pushes its snooze timer: it is stored done, newer than the iPhone's copy.
  const sent = await pushSnoozeTimer(call, "a-cagd", RING);
  assert.equal(sent.status, 200);
  const id = snoozeTimerId("a-cagd", RING);
  assert.equal(store.get("timers", id).state, "done");
  // Windows and the phones pull it done, so at 07:50 nothing rings anywhere.
  const pulled = await call("GET", "/api/sync?since=0", null, "MARO-PC");
  const row = pulled.body.changes.timers.find((t) => t.id === id);
  assert.equal(row.state, "done");
  set("07:50");
  assert.deepEqual(dueBetween(service.data(), at("2026-11-23", "07:46"), at("2026-11-23", "07:55"), TZ), []);
});

test("a skipped ring that still goes off on a stale phone cannot be snoozed back either", async () => {
  const { store, service, set } = account("07:36");
  const { call } = await open(store, service);
  runTool(service, "skip_alarm", { alarm_id: "a-cagd" });
  set("07:45");
  const stop = await call("POST", "/api/ring/stop", { alarm_id: "a-cagd", at: RING, action: "snoozed", device: "iPhone" });
  assert.equal(stop.body.snoozed, false);
  await pushSnoozeTimer(call, "a-cagd", RING);
  assert.equal(store.get("timers", snoozeTimerId("a-cagd", RING)).state, "done");
  // The skip holds; the alarm itself was never turned off.
  assert.equal(JSON.parse(store.get("prefs", "ring_stop:a-cagd").value).skipped, true);
  assert.equal(store.get("alarms", "a-cagd").enabled, 1);
});

test("dismissed on one device = over on all, even after a server restart: no auto-snooze, no late snooze", async () => {
  const { store, service, set } = account("07:45");
  const first = await open(store, service);
  await first.call("POST", "/api/ring/stop", { alarm_id: "a-cagd", at: RING, action: "dismissed", device: "iPhone" });
  // A fresh server on the same data (deploy, crash): the dismissal is still known.
  const { call } = await open(store, service);
  set("07:55");
  // Windows rang unanswered for 10 minutes and asks before auto-snoozing.
  const s = await state(call, "a-cagd", RING, "MARO-PC");
  assert.equal(s.body.stopped?.action, "dismissed");
  assert.equal(s.body.stopped?.device, "iPhone");
  // A snooze sent late (offline device) does not undo the dismissal...
  const late = await call("POST", "/api/ring/stop", { alarm_id: "a-cagd", at: RING, action: "snoozed", device: "SM-A075F" });
  assert.equal(late.body.snoozed, false);
  assert.equal(JSON.parse(store.get("prefs", "ring_stop:a-cagd").value).action, "dismissed");
  // ...nor a synced "snoozed" pref row...
  await call("POST", "/api/sync", { changes: { prefs: [{ id: "ring_stop:a-cagd", value: JSON.stringify({ at: RING, action: "snoozed", device: "SM-A075F", ts: Date.now() }), updated_at: Date.now() + 5000 }] } }, "SM-A075F");
  assert.equal(JSON.parse(store.get("prefs", "ring_stop:a-cagd").value).action, "dismissed");
  // ...and its snooze timer is stored done.
  await pushSnoozeTimer(call, "a-cagd", RING, "SM-A075F");
  assert.equal(store.get("timers", snoozeTimerId("a-cagd", RING)).state, "done");
});

test("a real snooze of a live alarm still works", async () => {
  const { store, service } = account("07:45");
  const { call } = await open(store, service);
  assert.equal((await state(call, "a-cagd", RING)).body.stopped, null);
  const stop = await call("POST", "/api/ring/stop", { alarm_id: "a-cagd", at: RING, action: "snoozed", device: "iPhone" });
  assert.notEqual(stop.body.snoozed, false);
  await pushSnoozeTimer(call, "a-cagd", RING);
  assert.equal(store.get("timers", snoozeTimerId("a-cagd", RING)).state, "running");
});
