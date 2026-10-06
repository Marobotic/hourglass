import QtQuick
import QtQuick.Controls.Basic

// Multi-line editor with its own scrolling.
ScrollView {
    id: sv
    property alias text: ta.text
    property alias placeholderText: ta.placeholderText
    property alias area: ta
    property int fontSize: 14
    property string family: Theme.mono
    // Enter on a "- ", "- [ ] " or "1. " line starts the next item (numbers
    // count on, and the rest of the list renumbers); on an empty item it ends
    // the list. Tab and Shift+Tab indent and outdent a list line.
    property bool smartLists: false
    clip: true
    ScrollBar.vertical.policy: ScrollBar.AsNeeded

    // Renumbers numbered lists, keeping the cursor where it was in its line.
    function renumberKeepingCursor() {
        const before = ta.text;
        const after = Util.renumber(before);
        if (after === before) return;
        const pos = ta.cursorPosition;
        const line = before.slice(0, pos).split("\n").length - 1;
        const col = pos - (before.lastIndexOf("\n", pos - 1) + 1);
        const fromNum = (/^\s*\d+\. /.exec(before.split("\n")[line]) || [""])[0].length;
        const rows = after.split("\n");
        const toNum = (/^\s*\d+\. /.exec(rows[line]) || [""])[0].length;
        let start = 0;
        for (let i = 0; i < line; i++) start += rows[i].length + 1;
        ta.text = after;
        ta.cursorPosition = Math.min(start + Math.max(0, col + toNum - fromNum), start + rows[line].length);
    }

    function lineStart(pos) { return ta.text.lastIndexOf("\n", pos - 1) + 1; }
    readonly property var listRe: /^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)\. )/

    TextArea {
        id: ta
        wrapMode: TextArea.Wrap
        color: Theme.fg
        placeholderTextColor: Theme.faint
        selectionColor: Theme.alpha(Theme.accent, 0.45)
        selectedTextColor: Theme.fg
        font.family: sv.family
        font.pixelSize: sv.fontSize
        textFormat: TextEdit.PlainText
        selectByMouse: true
        padding: 0
        background: null
        Keys.onReturnPressed: event => {
            if (!sv.smartLists || event.modifiers & Qt.ShiftModifier) { event.accepted = false; return; }
            const pos = ta.cursorPosition;
            const start = sv.lineStart(pos);
            const line = ta.text.slice(start, pos);
            const m = sv.listRe.exec(line);
            if (!m) { event.accepted = false; return; }
            if (line.trim() === m[2].trim()) { ta.remove(start, pos); return; } // empty item: end the list
            // A new to-do starts unticked; a number counts on.
            const next = /\[[ xX]\]/.test(m[2]) ? m[2].replace(/\[[xX]\]/, "[ ]") : m[3] ? (+m[3] + 1) + ". " : m[2];
            ta.insert(pos, "\n" + m[1] + next);
            if (m[3]) sv.renumberKeepingCursor();
        }
        Keys.onTabPressed: event => {
            const start = sv.lineStart(ta.cursorPosition);
            if (!sv.smartLists || !sv.listRe.test(ta.text.slice(start))) { event.accepted = false; return; }
            const pos = ta.cursorPosition;
            ta.insert(start, "   ");
            ta.cursorPosition = pos + 3;
            sv.renumberKeepingCursor();
        }
        Keys.onBacktabPressed: event => {
            const start = sv.lineStart(ta.cursorPosition);
            const lead = /^ {1,3}/.exec(ta.text.slice(start));
            if (!sv.smartLists || !lead || !sv.listRe.test(ta.text.slice(start))) { event.accepted = false; return; }
            const pos = ta.cursorPosition;
            ta.remove(start, start + lead[0].length);
            ta.cursorPosition = Math.max(start, pos - lead[0].length);
            sv.renumberKeepingCursor();
        }
    }
}
