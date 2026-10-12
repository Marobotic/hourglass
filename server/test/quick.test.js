// The assistant's fast lane (quick.js): common requests answered without a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../core/node/store.js";
import { Service } from "../../core/node/service.js";
import { zonedToEpoch, localParts } from "../../core/index.js";
import { quickAnswer, parseClock, parseDuration } from "../quick.js";

const TZ = "Africa/Cairo";
function setup(at = "2026-10-11 15:10") {
  const [d, t] = at.split(" ");
  let now = zonedToEpoch(d, t, TZ);
  const store = new Store(":memory:");
  store.setMeta("tz", TZ);
  const service = new Service(store, { clock: () => now });
  return { store, service, ask: (q) => quickAnswer(service, q), advance: (ms) => (now += ms) };
}
const alarms = (store) => store.all("alarms");

test("clock and duration words", () => {
  assert.deepEqual(parseClock("8 pm"), { minutes: 1200, ampm: true });
  assert.deepEqual(parseClock("8:30"), { minutes: 510, ampm: false });
  assert.deepEqual(parseClock("20.15"), { minutes: 1215, ampm: true });
  assert.equal(parseClock("noon").minutes, 720);
  assert.equal(parseClock("13 pm"), null);
  assert.equal(parseDuration("30 minutes"), 1800);
  assert.equal(parseDuration("1h 30m"), 5400);
  assert.equal(parseDuration("an hour and a half"), 5400);
  assert.equal(parseDuration("half an hour"), 1800);
  assert.equal(parseDuration("2 hours and a half"), 9000);
});

test("set up an alarm in 30 minutes", () => {
  const { store, ask } = setup("2026-10-11 15:10");
  const r = ask("Setup an alarm in 30 minutes");
  assert.ok(r, "answered");
  assert.match(r.text, /3:40 PM today \(in 30 minutes\)/);
  const [a] = alarms(store);
  assert.equal(a.time, "15:40");
  assert.equal(a.date, "2026-10-11");
  assert.deepEqual(r.tools.map((x) => x.tool), ["set_alarm"]);
});

test("wake me up at 8 PM EST: converted into the app's zone", () => {
  const { store, ask } = setup("2026-10-11 15:10");
  const r = ask("wake me up at 8 PM EST");
  assert.ok(r);
  const [a] = alarms(store);
  // 20:00 New York (EDT, UTC-4) = 03:00 Cairo (UTC+3) the next day.
  assert.equal(a.time, "03:00");
  assert.equal(a.date, "2026-10-12");
  assert.equal(a.label, "Wake up");
  assert.match(r.text, /3:00 AM tomorrow/);
  assert.match(r.text, /8:00 PM in New York/);
});

test("alarms: tomorrow, weekdays, labels, ambiguous hours", () => {
  const { store, ask } = setup("2026-10-11 15:10");
  assert.ok(ask("set an alarm for 7 tomorrow"));
  assert.equal(alarms(store).at(-1).time, "07:00");
  assert.equal(alarms(store).at(-1).date, "2026-10-12");
  assert.ok(ask("alarm at 8"));
  // 8 with no am/pm at 15:10: the next 8 is 20:00 today.
  assert.equal(alarms(store).at(-1).time, "20:00");
  assert.equal(alarms(store).at(-1).date, "2026-10-11");
  assert.ok(ask("wake me at 7:15 on weekdays"));
  assert.deepEqual(alarms(store).at(-1).days, [1, 2, 3, 4, 5]);
  assert.equal(alarms(store).at(-1).time, "07:15");
  assert.ok(ask("Set an alarm for 6:30 am called gym"));
  assert.equal(alarms(store).at(-1).label, "Gym");
  assert.ok(ask("remind me at 5pm to call mom"));
  assert.equal(alarms(store).at(-1).label, "Call mom");
  assert.equal(alarms(store).at(-1).time, "17:00");
});

test("things the fast lane leaves to the model", () => {
  const { store, ask } = setup();
  for (const q of [
    "set an alarm 10 minutes before every lecture",
    "set an alarm for when my class ends",
    "alarm",
    "wake me up early",
    "tidy my latest note",
    "when is my next lecture and what did I write last time",
    "set an alarm for 7 and also a timer",
  ]) assert.equal(ask(q), null, q);
  assert.equal(alarms(store).length, 0);
});

test("timers", () => {
  const { store, ask } = setup();
  assert.match(ask("25 minute timer").text, /25 minutes/);
  assert.match(ask("set a timer for 1h 30m called bread").text, /"Bread" timer started for 1 hour 30 minutes/);
  assert.match(ask("remind me in 10 minutes to check the oven").text, /Check the oven/);
  const t = store.all("timers");
  assert.deepEqual(t.map((x) => x.duration_s), [1500, 5400, 600]);
});

test("birthdays come from the calendar, then notes", () => {
  const { service, ask } = setup("2026-10-11 15:10");
  service.addEvent({ title: "Sara's birthday", date: "2026-02-07", start: "00:00", end: "23:59", repeat: { freq: "yearly" } });
  const r = ask("What's Sara's birthday?");
  assert.ok(r);
  assert.match(r.text, /Sara's birthday: Sun 7 Feb 2027/);
  assert.deepEqual(r.tools.map((x) => x.tool), ["find_events"]);
  service.addNote({ title: "People", body: "Omar - born 3 March\nLina likes tea" });
  const n = ask("when is omar's birthday");
  assert.match(n.text, /isn't in your calendar.*born 3 March/s);
  assert.match(ask("when is ziad's bday").text, /couldn't find Ziad's birthday/);
});

test("what's on today and now", () => {
  const { service, ask } = setup("2026-10-11 15:10");
  service.addEvent({ title: "Typography", date: "2026-10-11", start: "16:00", end: "18:00", location: "B729" });
  assert.match(ask("what's on today?").text, /4:00 PM-6:00 PM Typography \(B729\)/);
  assert.match(ask("what's next").text, /Next: Typography at 4:00 PM in B729/);
  assert.match(ask("what do I have tomorrow").text, /Nothing in your calendar tomorrow/);
});

test("list alarms", () => {
  const { ask } = setup("2026-10-11 15:10");
  assert.match(ask("what alarms do I have").text, /No alarms/);
  ask("wake me up at 7");
  assert.match(ask("show my alarms").text, /Wake up: 7:00 AM tomorrow/);
});

test("the app's own clock is what 'in 30 minutes' counts from", () => {
  const { store, ask } = setup("2026-10-11 23:50");
  ask("alarm in 30 minutes");
  const [a] = alarms(store);
  assert.equal(a.date, "2026-10-12");
  assert.equal(a.time, "00:20");
  assert.equal(localParts(zonedToEpoch(a.date, a.time, TZ), TZ).time, "00:20");
});
