// Checks the desktop note editor's HTML bridge against a real Qt TextEdit:
// each note goes into the editor and comes back as the same Markdown.
//   QT_FORCE_STDERR_LOGGING=1 windows/qt/bin/qml.exe tools/richtext-probe.qml
import QtQuick
import QtQuick.Window
import "../windows/app/Hourglass/richtext.mjs" as RT

Window {
    width: 700; height: 500; visible: true
    TextEdit {
        id: ed
        anchors.fill: parent
        textFormat: TextEdit.RichText
        font.family: "Inter"; font.pixelSize: 15
    }
    property var cases: [
        "# Title\nSome **bold** and *italic* and <u>under</u> and ~~strike~~.",
        "- one\n  - two\n1. first\n2. second\n- [ ] todo\n- [x] done",
        "![pic.png](hgfile:11111111-2222-3333-4444-555555555555)\n[a.pdf](hgfile:11111111-2222-3333-4444-666666666666)",
        "<span style=\"font-family: Caveat; font-size: 24px\">Hand</span> written and `code`",
        "a\n\nb\n\n\nc",
        "## Smaller heading\n### Smallest",
        "Link [site](https://x.dev) here",
        "  indented text & a < b",
        "- [x] done with ~~its own strike~~ and **bold**
  - [ ] still to do
- [x] *all done*",
    ]
    Component.onCompleted: {
        let fails = 0;
        for (const md of cases) {
            const r = RT.toHtml(md, { fileUrl: id => "http://127.0.0.1:1/files/" + id + "?k=x", imageWidth: 300 });
            ed.text = r.html;
            const back = RT.fromHtml(ed.getFormattedText(0, ed.length), r.names);
            if (back !== md) { fails++; console.log("FAIL\n  in:  " + JSON.stringify(md) + "\n  out: " + JSON.stringify(back)); }
            else console.log("ok   " + JSON.stringify(md).slice(0, 60));
        }
        // Bold over a stretch that mixes a font and the default: each run keeps its own font.
        ed.text = RT.toHtml("<span style=\"font-family: Lora; font-size: 24px\">Big</span> small", {}).html;
        const runs = RT.runsOf(ed.getFormattedText(0, ed.length), 0);
        for (const r of runs) {
            ed.select(r.start, r.end);
            ed.cursorSelection.font = Qt.font({ family: r.font || "Inter", pixelSize: r.size || 15, bold: true, italic: !!r.i, underline: !!r.u, strikeout: !!r.s });
        }
        const bold = RT.fromHtml(ed.getFormattedText(0, ed.length), {});
        const want = "<span style=\"font-family: Lora; font-size: 24px\">**Big**</span> **small**";
        if (bold !== want) { fails++; console.log("FAIL bold runs: " + JSON.stringify(bold)); } else console.log("ok   bold over mixed runs");
        // A to-do's box is hidden and its done look is not the note's strike; text
        // typed after a new item's marker is plain, even below a done item.
        // (Enter at the end of a done item: the new line starts in its done look.)
        ed.text = RT.toHtml("- [x] done", {}).html;
        ed.cursorPosition = ed.length;
        ed.insert(ed.length, "<br />X");
        ed.remove(ed.length - 1, ed.length);
        ed.insert(ed.length, RT.prefixHtml("☐ "));
        ed.insert(ed.length, "next");
        const typed = RT.fromHtml(ed.getFormattedText(0, ed.length), {});
        if (!/color:transparent|#00000000|rgba\(0, ?0, ?0, ?0\)/.test(ed.getFormattedText(0, 1))) { fails++; console.log("FAIL box not hidden: " + ed.getFormattedText(0, 1)); } else console.log("ok   box hidden");
        console.log((typed.indexOf("~~") < 0 ? "ok   " : (fails++, "FAIL ")) + "after a done item: " + JSON.stringify(typed));
        // Ticking a nested to-do the way the editor does: the line is written again.
        ed.text = RT.toHtml("- [ ] top
  - [ ] **nested** one", {}).html;
        const t2 = ed.getText(0, ed.length);
        const ls = t2.indexOf(" ") + 1;
        const lineRuns = RT.runsOf(ed.getFormattedText(ls + 4, ed.length), ls + 4);
        ed.remove(ls + 2, ed.length);
        ed.insert(ls + 2, RT.todoHtml(0, true, lineRuns));
        const ticked = RT.fromHtml(ed.getFormattedText(0, ed.length), {});
        console.log((ticked === "- [ ] top
  - [x] **nested** one" ? "ok   " : (fails++, "FAIL ")) + "tick nested: " + JSON.stringify(ticked));
        // Enter on a nested item: the next one keeps the indent.
        ed.text = RT.toHtml("- [ ] top
  - [ ] nested", {}).html;
        ed.insert(ed.length, "<br />X");
        ed.remove(ed.length - 1, ed.length);
        ed.insert(ed.length, RT.prefixHtml("  ☐ "));
        ed.insert(ed.length, "again");
        ed.insert(ed.length, "<br />X");
        ed.remove(ed.length - 1, ed.length);
        ed.insert(ed.length, RT.prefixHtml("  1. "));
        ed.insert(ed.length, "num");
        const nested = RT.fromHtml(ed.getFormattedText(0, ed.length), {});
        console.log((nested === "- [ ] top
  - [ ] nested
  - [ ] again
  1. num" ? "ok   " : (fails++, "FAIL ")) + "enter nested: " + JSON.stringify(nested));
        console.log(fails ? "FAILED " + fails : "ALL OK");
        Qt.exit(fails ? 1 : 0);
    }
}
