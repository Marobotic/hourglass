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
  assert.equal(store.all("reminders").at(-1).label, "Call mom", "a reminder, not an alarm");
  assert.equal(store.all("reminders").at(-1).time, "17:00");
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
  assert.match(ask("10 minute timer to check the oven").text, /Check the oven/);
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

test("alarms by what people call them, and 'it' is the one just touched", () => {
  const { store, service } = setup("2026-10-19 22:14");
  const ctx = {};
  const ask = (q) => {
    const r = quickAnswer(service, q, ctx);
    for (const c of r?.cards || []) if (c.kind === "alarm" && c.id && c.state !== "removed") Object.assign(ctx, { alarm_id: c.id, last: "alarm" });
    if (r?.ids?.alarm_id) Object.assign(ctx, { alarm_id: r.ids.alarm_id, last: "alarm" });
    return r;
  };
  const live = () => alarms(store).filter((a) => !a.deleted);
  ask("setup an alarm in 1 hour");
  assert.match(ask("remove my alarm that's in 1 hour").text, /Removed the 11:14 PM alarm/);
  assert.equal(live().length, 0);
  ask("set an alarm for 6:30am");
  assert.match(ask("make it 7 instead").text, /Moved your alarm to 7:00 AM tomorrow/);
  assert.equal(live()[0].time, "07:00");
  assert.match(ask("cancel it").text, /Removed/);
  ask("gym alarm 7am on thursdays");
  assert.match(ask("turn it off").text, /Turned off "Gym"/);
  assert.match(ask("turn it back on").text, /Turned on "Gym"/);
  assert.match(ask("move my gym alarm to 8am").text, /Moved "Gym" to 8:00 AM Thu/);
  assert.deepEqual(live()[0].days, [4], "a move keeps its days");
});

test("notes: a new one, or a line added to a list in the list's own style", () => {
  const { store, service } = setup("2026-10-19 22:14");
  service.addNote({ title: "Groceries", body: "- [ ] eggs\n- [ ] milk" });
  assert.match(quickAnswer(service, "add bread to my groceries list").text, /Added "bread" to Groceries/);
  assert.equal(store.all("notes").find((n) => n.title === "Groceries").body, "- [ ] eggs\n- [ ] milk\n- [ ] bread");
  assert.match(quickAnswer(service, "add a note: call the printer about A3 paper").text, /Saved a note "Call the printer about A3 paper"/);
  assert.equal(quickAnswer(service, "reorganize my notes"), null, "rewriting is the model's");
});

test("events: a title, a day and a time; an hour unless said", () => {
  const { service } = setup("2026-10-19 22:14");
  assert.match(quickAnswer(service, "add dentist on thursday at 4pm").text, /Added Dentist: Thu 22 Oct, 4:00 PM . 5:00 PM/);
  assert.match(quickAnswer(service, "add study group friday 4-6pm").text, /Study group: Fri 23 Oct, 4:00 PM . 6:00 PM/);
  assert.match(quickAnswer(service, "add gym session to my calendar tomorrow at 7am").text, /Added Gym session: tomorrow, 7:00 AM/);
  assert.equal(quickAnswer(service, "add a lecture for typography every monday"), null, "a course schedule is the model's");
});

test("reminders and timers by what people call them", () => {
  const { service } = setup("2026-10-20 10:14");
  const ctx = {};
  const ask = (q) => {
    const r = quickAnswer(service, q, ctx);
    if (r?.ids?.timer_id) Object.assign(ctx, { timer_id: r.ids.timer_id, last: "timer" });
    return r;
  };
  ask("remind me in 1 hour to play a game");
  assert.match(ask("Remove the 1 hour reminder to play a game").text, /Deleted "Play a game"/);
  ask("25 min timer");
  assert.match(ask("pause it").text, /Paused/);
  assert.match(ask("resume the timer").text, /Resumed/);
  assert.match(ask("add 5 minutes to my timer").text, /Added 5 min/);
  assert.match(ask("cancel it").text, /Cancelled/);
  ask("remind me to call mom at 9pm");
  assert.match(ask("cancel my reminder to call mom").text, /Deleted "Call mom"/);
});

test("events, attendance, world clock and settings at once", () => {
  const { service } = setup("2026-10-20 10:14");
  service.addCourse({ name: "Printmaking" });
  service.addEvent({ course: "Printmaking", date: "2026-09-22", start: "08:30", end: "15:29", repeat: { freq: "weekly", days: [2] } });
  service.addEvent({ title: "Dentist", date: "2026-10-22", start: "16:00", end: "17:00" });
  service.addEvent({ title: "Yoga", date: "2026-10-21", start: "18:00", end: "19:00", repeat: { freq: "weekly" } });
  assert.match(quickAnswer(service, "move the dentist to friday at 5pm").text, /Moved Dentist to Fri 23 Oct, 5:00 PM/);
  assert.match(quickAnswer(service, "remove wednesday's yoga").text, /Removed tomorrow's Yoga. The other ones stay/);
  assert.equal(quickAnswer(service, "cancel yoga"), null, "a whole series: the model asks first");
  assert.match(quickAnswer(service, "I was absent today").text, /Printmaking today as absent/);
  assert.equal(quickAnswer(service, "i missed my bus today"), null);
  assert.match(quickAnswer(service, "what time is it in tokyo").text, /in Tokyo, 6 h ahead of you/);
  assert.match(quickAnswer(service, "use 24 hour time").text, /24-hour/);
  assert.equal(service.settings().time_format, "24h");
  assert.match(quickAnswer(service, "set my ringtone to klaxon").text, /Klaxon/);
});

test("attendance by any day, however it's said", () => {
  const { service } = setup("2026-10-20 10:14");
  service.addCourse({ name: "Printmaking" });
  service.addEvent({ course: "Printmaking", date: "2026-09-22", start: "08:30", end: "15:29", repeat: { freq: "weekly", days: [2] } });
  assert.match(quickAnswer(service, "Mark today's attendence as attended").text, /Printmaking today as attended/);
  assert.match(quickAnswer(service, "mark attendance for today as present").text, /Printmaking today as attended/);
  assert.match(quickAnswer(service, "set attendance on 2026-10-13 to absent").text, /Tue 13 Oct as absent/);
  assert.match(quickAnswer(service, "mark 13 october as attended").text, /Tue 13 Oct as attended/);
  assert.match(quickAnswer(service, "mark last tuesday as off").text, /Tue 13 Oct as off/);
  assert.match(quickAnswer(service, "mark monday as attended").text, /no classes yesterday/);
  assert.match(quickAnswer(service, "mark history today as attended").text, /Today you have Printmaking/);
  assert.match(quickAnswer(service, "what do I have on 13 october").text, /Tue 13 Oct/);
});

test("the time and the date, at once", () => {
  const { service } = setup("2026-10-19 22:41");
  for (const q of ["what's the time right now", "whats the time", "what time is it", "time"]) assert.match(quickAnswer(service, q).text, /^It's 10:41 PM, Monday 19 October/, q);
  for (const q of ["what day is it", "whats the date today", "what is today"]) assert.match(quickAnswer(service, q).text, /^Today is Monday 19 October 2026/, q);
});

test("reminders: their own thing, set, listed, snoozed, done and deleted at once", () => {
  const { store, service, advance } = setup("2026-10-20 10:14");
  const ask = (q, ctx) => quickAnswer(service, q, ctx);
  let r = ask("remind me to call mom at 6pm");
  assert.match(r.text, /Reminder set for 6:00 PM today: Call mom/);
  assert.equal(r.cards[0].kind, "reminder");
  assert.equal(alarms(store).length, 0, "not an alarm");
  assert.equal(store.all("timers").length, 0, "not a timer");
  assert.match(ask("remind me at 9 tomorrow to pay rent").text, /9:00 AM tomorrow: Pay rent/);
  assert.match(ask("remind me in 20 minutes to stretch").text, /10:34 AM today \(in 20 minutes\): Stretch/);
  assert.match(ask("remind me every monday at 9am to take out the trash").text, /every Mon: Take out the trash/);
  assert.match(ask("set a reminder for 5pm to water the plants").text, /5:00 PM today: Water the plants/);
  assert.match(ask("remind me tomorrow to buy milk").text, /9:00 AM tomorrow: Buy milk/);
  assert.match(ask("remind me to go to the gym at 7pm").text, /7:00 PM today: Go to the gym/);
  assert.equal(service.listReminders().length, 7);
  const list = ask("what are my reminders");
  assert.match(list.text, /^Stretch: 10:34 AM today/);
  assert.match(ask("any reminders tomorrow?").text, /Pay rent: 9:00 AM tomorrow/);
  // Due and overdue, then snoozed and done.
  advance(30 * 60000);
  const [stretch] = service.listReminders();
  assert.equal(stretch.label, "Stretch");
  assert.ok(stretch.overdue);
  r = ask("snooze the stretch reminder for 15 minutes");
  assert.match(r.text, /Snoozed "Stretch" for 15 minutes/);
  assert.equal(service.listReminders().find((x) => x.label === "Stretch").due_at, service.clock() + 15 * 60000);
  assert.match(ask("mark it as done", { last: "reminder", reminder_id: stretch.id }).text, /Marked "Stretch" as done/);
  assert.ok(service.listReminders().find((x) => x.label === "Stretch").done);
  assert.match(ask("cancel the call mom reminder").text, /Deleted "Call mom"/);
  assert.equal(service.listReminders().length, 6);
  // Its own settings.
  assert.match(ask("make reminders silent").text, /only show a notification/);
  assert.equal(service.reminderSettings().style, "silent");
  assert.match(ask("use the harp tone for reminders").text, /Harp/);
  assert.deepEqual([service.reminderSettings().style, service.reminderSettings().tone], ["tone", "harp"]);
  assert.match(ask("set reminder snooze to 30 minutes").text, /30 minutes/);
  assert.equal(service.reminderSettings().snooze_min, 30);
});

test("a repeating reminder is pending from each time until done", () => {
  const { service, advance } = setup("2026-10-20 10:14"); // a Tuesday
  const r = service.addReminder({ label: "Pills", time: "09:00", days: [1, 2, 3, 4, 5, 6, 7] });
  let s = service.listReminders()[0];
  assert.equal(s.overdue, false, "today's 9:00 was before it existed");
  advance(24 * 3600000); // Wednesday 10:14
  s = service.listReminders()[0];
  assert.ok(s.overdue);
  service.updateReminder({ reminder_id: r.id, action: "done" });
  s = service.listReminders()[0];
  assert.equal(s.overdue, false);
  assert.equal(s.done, false, "repeating ones are never finished");
  assert.ok(s.due_at > service.clock());
});

test("settings changed anywhere are synced prefs", () => {
  const { store, service } = setup();
  service.setSettings({ time_format: "24h", week_start: 1, sound: false });
  assert.equal(store.get("prefs", "time_format").value, "24h");
  assert.equal(store.get("prefs", "sound").value, "false");
  // Another device's row wins over this device's old setting.
  store.upsert("prefs", { id: "time_format", value: "12h" });
  assert.equal(service.settings().time_format, "12h");
  assert.equal(service.settings().week_start, 1);
  assert.equal(service.settings().sound, false);
});
