#!/usr/bin/env node
// Seeds a demo university week through the public actions API.
//   node demo-seed.mjs http://127.0.0.1:8941 <token>
// Builds the week around the current time so one lecture is live.
const [base, token] = process.argv.slice(2);
const call = async (name, args) => {
  const r = await fetch(`${base}/api/actions/${name}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${name}: ${j.error}`);
  return j;
};
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
const h = now.getHours();
const liveStart = `${pad(Math.max(0, h - 1))}:00`, liveEnd = `${pad(Math.min(23, h + 1))}:00`;
const addDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const termStart = addDays(today, -28);

const algo = await call("add_course", {
  name: "Algorithms", code: "CS201", location: "Room 4.12", teacher: "Dr. Okafor", term_start: termStart, term_end: "2026-12-11",
  schedule: [{ day: dow, start: liveStart, end: liveEnd }, { day: "Thu", start: "14:00", end: "15:00", kind: "lab", location: "Lab B" }],
});
await call("add_course", {
  name: "Linear Algebra", code: "MA210", location: "Hall 2", teacher: "Prof. Lindqvist", term_start: termStart, term_end: "2026-12-11",
  schedule: [{ day: "Mon", start: "10:00", end: "12:00" }, { day: "Wed", start: "09:00", end: "10:00", kind: "tutorial" }],
});
await call("add_course", {
  name: "Operating Systems", code: "CS230", location: "Room 1.05", term_start: termStart, term_end: "2026-12-11",
  schedule: [{ day: "Tue", start: "13:00", end: "15:00" }, { day: "Fri", start: "09:00", end: "11:00" }],
});
await call("add_course", {
  name: "Technical Writing", code: "EN105", location: "Library 3", term_start: termStart, term_end: "2026-12-11",
  schedule: [{ day: dow === "Wed" ? "Thu" : "Wed", start: "16:00", end: "17:30", kind: "tutorial" }],
});
await call("add_event", { title: "Study group", date: addDays(today, 1), start: "18:00", end: "19:30", location: "Café" });
await call("add_event", { title: "Linear Algebra midterm", course: "Linear Algebra", kind: "exam", date: addDays(today, 9), start: "10:00", end: "12:00", location: "Sports Hall" });

await call("add_note", { course: "Algorithms", pinned: true, title: "Syllabus & grading", body: "# Grading\n- Problem sets 30%\n- Midterm 30%\n- Final 40%\n\nOffice hours Thu 15:00, Room 4.20." });
await call("add_note", { course: "Algorithms", date: addDays(today, -7), title: "Divide and conquer", body: "## Master theorem\nT(n) = aT(n/b) + f(n)\n\n- Case 1: f grows slower than n^log_b(a)\n- Merge sort: a=2, b=2, f=n, so Θ(n log n)\n\n**Next week:** dynamic programming." });
await call("add_note", { course: "Algorithms", date: addDays(today, -14), title: "Big-O recap", body: "Asymptotic notation, O, Ω, Θ. Loop invariants." });
await call("add_note", { course: "Algorithms", title: "Dynamic programming", body: "## Memoisation vs tabulation\n- Fibonacci: O(2^n) naive, O(n) memoised\n- Knapsack table: rows items, columns capacity\n\nQuestion for office hours: when is greedy enough?" });
await call("add_note", { course: "Linear Algebra", date: addDays(today, -2), title: "Eigenvalues", body: "det(A - λI) = 0. Diagonalisation when there are n independent eigenvectors." });
await call("add_note", { course: "Operating Systems", date: addDays(today, -1), title: "Scheduling", body: "Round robin, quantum trade-offs. CFS uses a red-black tree keyed by vruntime." });
await call("set_alarm", { time: "07:15", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], label: "Wake up" });
await call("set_alarm", { before: "Linear Algebra", minutes_before: 15 });
await call("start_timer", { minutes: 25, label: "Problem set 3" });
console.log("seeded", algo.course.name, "live", liveStart, "-", liveEnd, "on", dow);
