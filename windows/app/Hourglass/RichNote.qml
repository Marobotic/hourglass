import QtQuick
import QtQuick.Controls.Basic
import "noteformat.mjs" as NF
import "richtext.mjs" as RT

// A note as you write it, like a word processor: no Markdown on screen, no
// separate preview. Select text, then bold, a font, a size; lists keep their
// marker in front ("• ", "☐ ", "1. "); a to-do's ☐ is hidden under a themed box
// that ticks with a click (a done item dims and is struck through). Pictures show
// in place. The note is still stored as Markdown (noteformat.mjs): `markdown()`
// reads it back out of the editor, `load()` puts one in.
ScrollView {
    id: rn
    property var info: null // { file_base, key }: how this window loads Drive files
    property var names: ({}) // Drive file id -> name, for pictures and files in the note
    property bool loading: false
    readonly property alias editor: ed
    readonly property var fonts: NF.FONTS
    readonly property var sizes: NF.SIZES
    // What the toolbar shows: the format at the cursor or the selection's start.
    property var here: ({ b: false, i: false, u: false, s: false, font: NF.FONTS[0], size: NF.DEFAULT_SIZE })
    signal edited()
    signal openFile(string id)
    clip: true
    contentWidth: availableWidth
    ScrollBar.vertical.policy: ScrollBar.AsNeeded

    readonly property string sep: String.fromCharCode(0x2029)
    readonly property string soft: String.fromCharCode(0x2028)
    readonly property int imageWidth: Math.max(160, Math.min(640, rn.availableWidth - 40))

    function fileUrl(id) { return info ? info.file_base + id + "?k=" + info.key : "hgfile:" + id; }

    function load(md) {
        loading = true;
        const r = RT.toHtml(md || "", { fileUrl: fileUrl, imageWidth: imageWidth });
        names = r.names;
        ed.text = r.html;
        loading = false;
        pending = null;
        readHere();
        placeBoxes();
    }
    function markdown() {
        return RT.fromHtml(ed.getFormattedText(0, ed.length), names, { baseFont: NF.FONTS[0], baseSize: NF.DEFAULT_SIZE });
    }

    // --- formatting ---------------------------------------------------------------

    function family(r) { return r.code ? RT.CODE_FONT : (r.font || NF.FONTS[0]); }
    function fontOf(r, change) {
        const c = change || {};
        return Qt.font({
            family: c.font !== undefined ? (c.font || NF.FONTS[0]) : family(r),
            pixelSize: c.size !== undefined ? (c.size || NF.DEFAULT_SIZE) : (r.size || NF.DEFAULT_SIZE),
            bold: c.b !== undefined ? c.b : !!r.b,
            italic: c.i !== undefined ? c.i : !!r.i,
            underline: c.u !== undefined ? c.u : !!r.u,
            strikeout: c.s !== undefined ? c.s : !!r.s,
        });
    }
    function runs(a, b) { return RT.runsOf(ed.getFormattedText(a, b), a, { baseFont: NF.FONTS[0], baseSize: NF.DEFAULT_SIZE }); }

    // Change some of b/i/u/s/font/size over [a, b), run by run, so each run keeps
    // everything else it had (Qt's own font setter would reset it all).
    function applyRange(a, b, change) {
        for (const r of runs(a, b)) {
            ed.select(r.start, r.end);
            ed.cursorSelection.font = fontOf(r, change);
        }
    }

    // Nothing selected: the change waits for the next thing typed here.
    property var pending: null
    property int pendingAt: -1
    property int pendingLen: -1

    function format(change) {
        const a = ed.selectionStart, b = ed.selectionEnd;
        if (a === b) {
            pending = Object.assign({}, pending || {}, change);
            pendingAt = a;
            pendingLen = ed.length;
            readHere();
            ed.forceActiveFocus();
            return;
        }
        applyRange(a, b, change);
        ed.select(a, b);
        ed.forceActiveFocus();
        readHere();
        rn.edited();
    }
    // Bold, italic, underline, strike: on unless the whole selection has it already.
    function toggle(key) {
        const a = ed.selectionStart, b = ed.selectionEnd;
        const list = a === b ? [] : runs(a, b).filter(r => r.text.trim());
        const on = a === b ? !here[key] : !(list.length && list.every(r => r[key]));
        const c = {};
        c[key] = on;
        format(c);
    }

    // The lines the cursor or selection touches: [{ start, end, text }].
    function linesTouched() {
        const t = ed.getText(0, ed.length);
        const a = ed.selectionStart, b = ed.selectionEnd;
        const out = [];
        let start = 0;
        for (let i = 0; i <= t.length; i++) {
            if (i === t.length || t[i] === sep || t[i] === soft) {
                if (i >= a && start <= b) out.push({ start: start, end: i, text: t.slice(start, i) });
                start = i + 1;
                if (start > b) break;
            }
        }
        return out;
    }

    // "• ", "☐ " or "1. " in front of every selected line; again takes it off.
    function setList(kind) {
        const touched = linesTouched();
        const lines = touched.filter(l => l.text.trim() || touched.length === 1);
        if (!lines.length) return;
        const all = lines.every(l => NF.kindOf(l.text).kind === kind);
        let n = 0;
        // From the last line up, so earlier positions stay right.
        const edits = lines.map(l => {
            const k = NF.kindOf(l.text);
            const indent = k.kind === "p" ? 0 : k.indent;
            const pre = all ? "" : NF.prefixOf({ kind: kind, indent: indent, num: ++n, checked: false });
            return { at: l.start, drop: k.prefix, insert: pre };
        });
        for (let k = edits.length - 1; k >= 0; k--) {
            const e = edits[k];
            if (e.drop) ed.remove(e.at, e.at + e.drop);
            if (e.insert) ed.insert(e.at, RT.prefixHtml(e.insert));
        }
        ed.forceActiveFocus();
        rn.edited();
    }

    // A heading: the whole line bold at the heading size. Again takes it off.
    function setHeading(level) {
        const lines = linesTouched().filter(l => l.text.trim());
        if (!lines.length) return;
        const size = NF.HEADING_SIZES[level];
        const a0 = ed.selectionStart, b0 = ed.selectionEnd;
        const isOn = lines.every(l => runs(l.start, l.end).filter(r => r.text.trim()).every(r => r.b && r.size === size));
        for (const l of lines) {
            const k = NF.kindOf(l.text);
            applyRange(l.start + k.prefix, l.end, isOn ? { b: false, size: NF.DEFAULT_SIZE } : { b: true, size: size });
        }
        ed.select(a0, b0);
        ed.forceActiveFocus();
        readHere();
        rn.edited();
    }

    function readHere() {
        const f = ed.cursorSelection.font;
        const p = pending || {};
        here = {
            b: p.b !== undefined ? p.b : f.bold,
            i: p.i !== undefined ? p.i : f.italic,
            u: p.u !== undefined ? p.u : f.underline,
            s: p.s !== undefined ? p.s : f.strikeout,
            font: p.font !== undefined ? p.font : (NF.FONTS.indexOf(f.family) >= 0 ? f.family : NF.FONTS[0]),
            size: p.size !== undefined ? p.size : (f.pixelSize > 0 ? f.pixelSize : NF.DEFAULT_SIZE),
        };
    }

    // --- lists as you type ------------------------------------------------------------

    function lineAround(pos) {
        const t = ed.getText(0, ed.length);
        let s = pos;
        while (s > 0 && t[s - 1] !== sep && t[s - 1] !== soft) s--;
        let e = pos;
        while (e < t.length && t[e] !== sep && t[e] !== soft) e++;
        return { start: s, end: e, text: t.slice(s, e) };
    }

    // Enter on a list line starts the next item; on an empty item it ends the list.
    function onEnter(event) {
        // A Keys handler takes the key unless told otherwise: the editor makes the new line.
        event.accepted = false;
        if (event.modifiers & Qt.ShiftModifier) return;
        if (ed.selectionStart !== ed.selectionEnd) return;
        const l = lineAround(ed.cursorPosition);
        const next = NF.continuePrefix(l.text);
        if (next === null) return;
        if (next === "") {
            ed.remove(l.start, l.start + NF.kindOf(l.text).prefix);
            event.accepted = true;
            rn.edited();
            return;
        }
        // Let the editor make the new line, then put the marker in front of it.
        Qt.callLater(() => { ed.insert(ed.cursorPosition, RT.prefixHtml(next)); rn.edited(); });
    }
    // Tab and Shift+Tab move a list line in and out.
    function indent(by) {
        const lines = linesTouched().filter(l => NF.kindOf(l.text).kind !== "p");
        if (!lines.length) return false;
        for (let k = lines.length - 1; k >= 0; k--) {
            const l = lines[k];
            if (by > 0) ed.insert(l.start, "  ");
            else if (l.text.startsWith("  ")) ed.remove(l.start, l.start + 2);
        }
        rn.edited();
        return true;
    }

    // --- to-do boxes -------------------------------------------------------------------

    // Where each to-do's hidden ☐/☑ sits: [{ at, x, y, h, w, checked }].
    property var boxes: []
    function placeBoxes() {
        const t = ed.getText(0, ed.length);
        const out = [];
        let start = 0;
        for (let i = 0; i <= t.length; i++) {
            if (i < t.length && t[i] !== sep && t[i] !== soft) continue;
            const k = NF.kindOf(t.slice(start, i));
            if (k.kind === "todo") {
                const g = start + k.indent * 2;
                const r = ed.positionToRectangle(g), r2 = ed.positionToRectangle(g + 1);
                out.push({ at: g, x: r.x, y: r.y, h: r.height, w: Math.max(12, r2.x - r.x), checked: !!k.checked });
            }
            start = i + 1;
        }
        boxes = out;
    }
    // Text edits and wrapping move the boxes: placed again once things settle.
    property bool placing: false
    function placeSoon() {
        if (placing) return;
        placing = true;
        Qt.callLater(() => { placing = false; placeBoxes(); });
    }

    // Tick or untick the to-do whose box is at g: the line is written again in
    // its new look (done: dimmed and struck through), keeping its own formatting.
    function tick(g) {
        const l = lineAround(g);
        const k = NF.kindOf(l.text);
        if (k.kind !== "todo") return;
        if (!k.checked) {
            const r = ed.positionToRectangle(g);
            Motion.burstAt(ed, r.x + 6, r.y + r.height / 2);
        }
        const keep = ed.cursorPosition;
        // From the box on: the indent in front stays as it is.
        const html = RT.todoHtml(0, !k.checked, runs(l.start + k.prefix, l.end));
        ed.remove(g, l.end);
        ed.insert(g, html);
        ed.cursorPosition = Math.min(keep, ed.length);
        rn.edited();
        placeSoon();
    }

    // On a picture or a Drive file a click opens it; Ctrl+click opens a web link.
    function clicked(x, y, modifiers) {
        const pos = ed.positionAt(x, y);
        const link = ed.linkAt(x, y);
        if (link) {
            if (link.indexOf("hgfile:") === 0) rn.openFile(link.slice(7));
            else if (modifiers & Qt.ControlModifier) Qt.openUrlExternally(link);
            return;
        }
        // A picture is one character: its <img> names the file.
        for (const p of [pos, pos - 1]) {
            if (p < 0 || ed.getText(p, p + 1) !== String.fromCharCode(0xfffc)) continue;
            const m = /\/files\/([0-9a-f-]{36})/.exec(ed.getFormattedText(p, p + 1));
            const box = ed.positionToRectangle(p);
            if (m && Math.abs(x - box.x) < rn.imageWidth + 10) { rn.openFile(m[1]); return; }
        }
    }

    TextEdit {
        id: ed
        width: rn.availableWidth
        textFormat: TextEdit.RichText
        wrapMode: TextEdit.Wrap
        selectByMouse: true
        persistentSelection: true
        color: Theme.fg
        selectionColor: Theme.alpha(Theme.accent, 0.45)
        selectedTextColor: Theme.fg
        font.family: NF.FONTS[0]
        font.pixelSize: NF.DEFAULT_SIZE
        topPadding: 4
        bottomPadding: 40
        onTextChanged: {
            if (rn.loading) return;
            // Typing after a change chosen with nothing selected: the new text takes it.
            if (rn.pending && ed.length > rn.pendingLen && ed.cursorPosition > rn.pendingAt) {
                const p = rn.pending, a = rn.pendingAt, b = ed.cursorPosition;
                rn.pending = null;
                rn.applyRange(a, b, p);
                ed.cursorPosition = b;
            }
            rn.edited();
            rn.placeSoon();
        }
        onWidthChanged: rn.placeSoon()
        onCursorPositionChanged: {
            if (rn.pending && ed.length === rn.pendingLen && ed.cursorPosition !== rn.pendingAt) rn.pending = null;
            // Never between a to-do's hidden box and its space: what is typed there would be invisible.
            const c = ed.cursorPosition;
            if (ed.selectionStart === ed.selectionEnd && c > 0 && ed.getText(c, c + 1) === " ") {
                const before = ed.getText(c - 1, c);
                if ((before === NF.BOX || before === NF.CHECKED) && NF.kindOf(rn.lineAround(c).text).kind === "todo") ed.cursorPosition = c + 1;
            }
            rn.readHere();
        }
        onSelectedTextChanged: rn.readHere()
        Keys.onReturnPressed: event => rn.onEnter(event)
        Keys.onEnterPressed: event => rn.onEnter(event)
        Keys.onTabPressed: event => { event.accepted = rn.indent(1); }
        Keys.onBacktabPressed: event => { event.accepted = rn.indent(-1); }
        HoverHandler { cursorShape: ed.hoveredLink ? Qt.PointingHandCursor : Qt.IBeamCursor }
        TapHandler {
            id: tap
            acceptedButtons: Qt.LeftButton
            gesturePolicy: TapHandler.DragThreshold
            onTapped: (eventPoint, button) => rn.clicked(eventPoint.position.x, eventPoint.position.y, tap.point.modifiers)
        }
        // The to-dos' boxes, drawn over their hidden ☐/☑: the old themed box.
        Repeater {
            model: rn.boxes
            Rectangle {
                id: box
                required property var modelData
                readonly property int side: Math.max(12, Math.min(16, modelData.h - 4))
                x: modelData.x + 1
                y: modelData.y + (modelData.h - side) / 2
                width: side; height: side
                color: modelData.checked ? Theme.accent : boxMouse.containsMouse ? Theme.surface2 : Theme.bg
                border.width: modelData.checked ? 0 : 1
                border.color: boxMouse.containsMouse ? Theme.accent : Theme.muted
                Behavior on color { ColorAnimation { duration: 120 } }
                Icon { anchors.centerIn: parent; visible: box.modelData.checked; name: "check"; size: box.side - 5; color: Theme.accentInk }
                MouseArea {
                    id: boxMouse
                    anchors.fill: parent
                    anchors.margins: -4
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: rn.tick(box.modelData.at)
                }
            }
        }
        Text {
            visible: ed.length === 0 && !ed.activeFocus
            text: "Write here. Select text to make it bold, pick a font or a size, or start a list."
            color: Theme.faint
            font: ed.font
            y: ed.topPadding
        }
    }
}
