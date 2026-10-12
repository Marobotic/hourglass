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
        console.log(fails ? "FAILED " + fails : "ALL OK");
        Qt.exit(fails ? 1 : 0);
    }
}
