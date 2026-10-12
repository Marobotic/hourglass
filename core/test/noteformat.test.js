// The note format: what the editors on every platform read and write.
// Note.kt (Android) and NoteFormat.swift (iOS) port core/noteformat.js and
// must give the same answers for these cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseInline, serialize, serializeInline, plainText, renumber, kindOf, continuePrefix, prefixOf } from "../noteformat.js";

const round = (md) => serialize(parse(md));

test("plain Markdown reads as styled runs", () => {
  assert.deepEqual(parseInline("a **bold** and *it* <u>under</u> ~~gone~~ `code`"), [
    { text: "a " }, { text: "bold", b: true }, { text: " and " }, { text: "it", i: true }, { text: " " },
    { text: "under", u: true }, { text: " " }, { text: "gone", s: true }, { text: " " }, { text: "code", code: true },
  ]);
  assert.deepEqual(parseInline("***both***"), [{ text: "both", b: true, i: true }]);
  assert.deepEqual(parseInline("_it_ snake_case"), [{ text: "it", i: true }, { text: " snake_case" }]);
  // A lone star between spaces is just a star.
  assert.deepEqual(parseInline("5 * 3"), [{ text: "5 * 3" }]);
  assert.deepEqual(parseInline("see [site](https://x.dev) now"), [{ text: "see " }, { text: "site", href: "https://x.dev" }, { text: " now" }]);
});

test("fonts and sizes travel in a span", () => {
  assert.deepEqual(parseInline('<span style="font-family: Lora; font-size: 20px">big</span> small'), [
    { text: "big", font: "Lora", size: 20 }, { text: " small" },
  ]);
  // The default font and size are no style at all.
  assert.deepEqual(parseInline('<span style="font-family: Inter; font-size: 15px">x</span>'), [{ text: "x" }]);
  assert.equal(serializeInline([{ text: "big", font: "Lora", size: 20, b: true }, { text: " small" }]),
    '<span style="font-family: Lora; font-size: 20px">**big**</span> small');
});

test("lines: headings, lists, to-dos, attachments", () => {
  const lines = parse("# Title\n- one\n  - nested\n1. first\n- [ ] todo\n- [x] done\n![pic.png](hgfile:11111111-2222-3333-4444-555555555555)\n[a.pdf](hgfile:11111111-2222-3333-4444-666666666666)\nplain");
  assert.deepEqual(lines.map((l) => [l.kind, l.indent, l.h || 0]), [
    ["p", 0, 1], ["ul", 0, 0], ["ul", 1, 0], ["ol", 0, 0], ["todo", 0, 0], ["todo", 0, 0], ["image", 0, 0], ["file", 0, 0], ["p", 0, 0],
  ]);
  assert.equal(lines[5].checked, true);
  assert.equal(lines[6].file.id, "11111111-2222-3333-4444-555555555555");
  assert.equal(lines[7].file.name, "a.pdf");
});

test("round trips keep the note as it was", () => {
  for (const md of [
    "# Title\nSome **bold** and *italic* and <u>under</u> and ~~strike~~.",
    "- one\n  - two\n1. first\n2. second\n- [ ] todo\n- [x] done",
    "![pic.png](hgfile:11111111-2222-3333-4444-555555555555)",
    '<span style="font-family: Caveat; font-size: 24px">Hand</span> written',
    "Stars \\* and \\_under\\_ and a \\[bracket",
    "snake_case stays",
    "",
    "a\n\nb",
  ]) assert.equal(round(md), md, md);
});

test("text that looks like Markdown stays text", () => {
  for (const text of ["- not a list", "1. not numbered", "# not a heading", "a * b", "<b>tag</b>", "~~x~~", "[x](y)", "`tick`"]) {
    const md = serialize([{ kind: "p", indent: 0, runs: [{ text }] }]);
    assert.deepEqual(parse(md)[0].runs, [{ text }], `${text} -> ${md}`);
    assert.equal(parse(md)[0].kind, "p");
  }
});

test("mixed styles side by side survive", () => {
  const cases = [
    [{ text: "a", b: true }, { text: "b", b: true, i: true }, { text: "c", i: true }, { text: "d" }],
    [{ text: "x", i: true }, { text: "y", b: true }],
    [{ text: "big", size: 24 }, { text: "bold big", size: 24, b: true }, { text: " under", u: true, font: "Lora" }],
    [{ text: "one", s: true, b: true }, { text: "two", s: true }],
  ];
  for (const runs of cases) {
    const md = serializeInline(runs);
    assert.deepEqual(parseInline(md), runs, md);
  }
});

test("spaces at the edges of bold move outside the stars", () => {
  assert.equal(serializeInline([{ text: "a" }, { text: " bold ", b: true }, { text: "c" }]), "a **bold** c");
});

test("plain text for previews and search", () => {
  assert.equal(plainText('# Hi\n- [x] done\n<span style="font-size: 20px">**big**</span>\n![p](hgfile:11111111-2222-3333-4444-555555555555)'), "Hi\n☑ done\nbig\n[picture: p]");
});

test("editor prefixes and Enter on a list line", () => {
  assert.deepEqual(kindOf("• item"), { kind: "ul", indent: 0, prefix: 2 });
  assert.deepEqual(kindOf("  ☑ done"), { kind: "todo", indent: 1, prefix: 4, checked: true });
  assert.deepEqual(kindOf("12. x"), { kind: "ol", indent: 0, prefix: 4, num: 12 });
  assert.equal(kindOf("plain").kind, "p");
  assert.equal(continuePrefix("3. x"), "4. ");
  assert.equal(continuePrefix("☑ x"), "☐ ");
  assert.equal(continuePrefix("• "), "");
  assert.equal(continuePrefix("text"), null);
  assert.equal(prefixOf({ kind: "todo", indent: 1, checked: false }), "  ☐ ");
});

test("renumber counts each list from 1", () => {
  const lines = renumber(parse("3. a\n7. b\n\n5. c\n  9. d\n6. e"));
  assert.deepEqual(lines.filter((l) => l.kind === "ol").map((l) => l.num), [1, 2, 1, 1, 2]);
});

test("the desktop app carries the same file", () => {
  const strip = (s) => s.replace(/\r/g, "");
  const src = strip(readFileSync(join(import.meta.dirname, "..", "noteformat.js"), "utf8"));
  for (const os of ["windows", "linux"]) {
    const copy = strip(readFileSync(join(import.meta.dirname, "..", "..", os, "app", "Hourglass", "noteformat.mjs"), "utf8"));
    assert.equal(copy, src, `${os}/app/Hourglass/noteformat.mjs differs from core/noteformat.js`);
  }
});
