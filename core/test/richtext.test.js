// The desktop editor's HTML bridge (windows/app/Hourglass/richtext.mjs): a
// note through the editor's HTML and back is the same note. The Qt side (what
// a TextEdit writes back) is checked by tools/richtext-probe.qml.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toHtml, fromHtml, runsOf } from "../../windows/app/Hourglass/richtext.mjs";

const ctx = { fileUrl: (id) => `http://127.0.0.1:8931/files/${id}?k=x`, imageWidth: 400 };
const round = (md) => { const { html, names } = toHtml(md, ctx); return fromHtml(html, names); };

test("notes survive the editor's HTML", () => {
  for (const md of [
    "# Title\nSome **bold** and *italic* and <u>under</u> and ~~strike~~.",
    "- one\n  - two\n1. first\n2. second\n- [ ] todo\n- [x] done",
    "![pic.png](hgfile:11111111-2222-3333-4444-555555555555)\n[a.pdf](hgfile:11111111-2222-3333-4444-666666666666)",
    '<span style="font-family: Caveat; font-size: 24px">Hand</span> written and `code`',
    "a\n\nb\n\n\nc",
    "## Smaller heading\n### Smallest",
    "Link [site](https://x.dev) here",
    String.raw`Stars \* and \_under\_`,
  ]) assert.equal(round(md), md, md);
});

test("Qt's own HTML reads back", () => {
  // As a Qt TextEdit writes it (Qt 6.8).
  const qt = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0//EN" "http://www.w3.org/TR/REC-html40/strict.dtd">
<html><head><meta name="qrichtext" content="1" /><meta charset="utf-8" /><style type="text/css">
p, li { white-space: pre-wrap; }
</style></head><body style=" font-family:'Inter'; font-size:15px; font-weight:400; font-style:normal;">
<p style=" margin-top:0px; margin-bottom:0px;"><!--StartFragment--><span style=" font-family:'Lora'; font-size:24px;">Hello</span> <span style=" font-weight:700;">bold</span> &amp; <span style=" font-family:'Inter'; font-size:15px; font-style:italic;">it</span></p>
<p style="-qt-paragraph-type:empty; margin-top:0px; margin-bottom:0px;"><br /></p>
<p style=" margin-top:0px;">☑ <span style=" text-decoration: underline line-through;">both</span></p>
<h2 style=" margin-top:16px;"><span style=" font-size:x-large; font-weight:700;">Head</span></h2>
<p style=" margin-top:0px;">one<br />two</p>
<ul style="margin-top: 0px;"><li style=" margin-top:0px;">pasted</li><li class="checked">done</li></ul>
<p style=" margin-top:0px;"><img src="http://127.0.0.1:8931/files/11111111-2222-3333-4444-555555555555?k=x" width="400" /></p>
<p style=" margin-top:0px;"><a href="hgfile:11111111-2222-3333-4444-666666666666"><span style=" text-decoration: underline; color:#d203d2;">📎 a.pdf</span></a><!--EndFragment--></p></body></html>`;
  assert.equal(fromHtml(qt, { "11111111-2222-3333-4444-555555555555": "pic.png" }),
    '<span style="font-family: Lora; font-size: 24px">Hello</span> **bold** & *it*\n\n- [x] <u>~~both~~</u>\n## Head\none\ntwo\n- pasted\n- [x] done\n![pic.png](hgfile:11111111-2222-3333-4444-555555555555)\n[a.pdf](hgfile:11111111-2222-3333-4444-666666666666)');
});

test("runs carry their place in the editor", () => {
  const html = `<p>ab<span style="font-weight:700">cd</span></p><p style="-qt-paragraph-type:empty"><br /></p><p>e<br />f</p>`;
  assert.deepEqual(runsOf(html, 10).map((r) => [r.text, r.start, r.end, !!r.b]), [
    ["ab", 10, 12, false], ["cd", 12, 14, true], ["e", 16, 17, false], ["f", 18, 19, false],
  ]);
});
