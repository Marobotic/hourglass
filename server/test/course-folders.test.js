// Folders inside a course's Drive folder: listing, making, moving.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../../core/node/store.js";
import { Service } from "../../core/node/service.js";

function setup() {
  const store = new Store(":memory:");
  const service = new Service(store);
  const { course } = service.addCourse({ name: "Porcelain Formation" });
  const { course: other } = service.addCourse({ name: "Typography" });
  return { store, service, course, other };
}
const names = (rows) => rows.map((r) => r.name);

test("a course holds folders; they stay out of the Drive's own lists", () => {
  const { store, service, course } = setup();
  const lectures = service.addFolder({ name: "lectures", course_id: course.id });
  const english = service.addFolder({ name: "English", parent_id: lectures.id });
  assert.equal(lectures.course_id, course.id);
  assert.equal(english.course_id, course.id, "a folder inside a course folder is in the course");
  store.upsert("files", { name: "week 7.docx", course_id: course.id, folder_id: lectures.id });
  store.upsert("files", { name: "Exams.pdf", course_id: course.id, folder_id: english.id });
  store.upsert("files", { name: "syllabus.pdf", course_id: course.id });
  service.addFolder({ name: "Personal" });

  const top = service.listDrive({});
  assert.deepEqual(names(top.folders), ["Personal"]);
  assert.deepEqual(names(top.files), []);
  assert.equal(top.courses.find((c) => c.id === course.id).items, 3);

  const c = service.listDrive({ course_id: course.id });
  assert.deepEqual(names(c.folders), ["lectures"]);
  assert.equal(c.folders[0].items, 2);
  assert.deepEqual(names(c.files), ["syllabus.pdf"]);

  const inside = service.listDrive({ course_id: course.id, folder_id: english.id });
  assert.deepEqual(inside.path.map((p) => p.name), ["Porcelain Formation", "lectures", "English"]);
  assert.ok(inside.path[0].course);
  assert.deepEqual(names(inside.files), ["Exams.pdf"]);
});

test("files and folders move into and out of a course with everything in them", () => {
  const { store, service, course, other } = setup();
  const plain = service.addFolder({ name: "Notes" });
  const sub = service.addFolder({ name: "Week 1", parent_id: plain.id });
  const file = store.upsert("files", { name: "a.pdf", folder_id: sub.id });

  service.moveFolder({ folder_id: plain.id, course_id: course.id });
  assert.equal(store.get("folders", plain.id).course_id, course.id);
  assert.equal(store.get("folders", sub.id).course_id, course.id);
  assert.equal(store.get("files", file.id).course_id, course.id);
  assert.equal(store.get("files", file.id).folder_id, sub.id);

  // A file dropped on a course folder takes its course.
  const loose = store.upsert("files", { name: "b.pdf" });
  service.moveFile({ file_id: loose.id, folder_id: sub.id });
  assert.deepEqual([store.get("files", loose.id).course_id, store.get("files", loose.id).folder_id], [course.id, sub.id]);
  // To another course's top: out of the folder.
  service.moveFile({ file_id: loose.id, course: other.id });
  assert.deepEqual([store.get("files", loose.id).course_id, store.get("files", loose.id).folder_id], [other.id, null]);
  assert.throws(() => service.moveFile({ file_id: loose.id, course: other.id, folder_id: sub.id }), /not in that course/);

  // Back to the Drive's top: the folder and all in it leave the course.
  service.moveFolder({ folder_id: plain.id, parent_id: null });
  assert.equal(store.get("folders", plain.id).course_id, null);
  assert.equal(store.get("folders", sub.id).course_id, null);
  assert.equal(store.get("files", file.id).course_id, null);
  assert.deepEqual(names(service.listDrive({}).folders), ["Notes"]);
});

test("an archived course's folders and a file in a gone folder still show", () => {
  const { store, service, course } = setup();
  const f = service.addFolder({ name: "Old", course_id: course.id });
  const lost = store.upsert("files", { name: "lost.pdf", course_id: course.id, folder_id: "no-such-folder" });
  assert.deepEqual(names(service.listDrive({ course_id: course.id }).files), ["lost.pdf"]);
  store.upsert("courses", { id: course.id, archived: 1 });
  assert.ok(names(service.listDrive({}).folders).includes("Old"));
  assert.ok(lost);
  assert.ok(f);
});
