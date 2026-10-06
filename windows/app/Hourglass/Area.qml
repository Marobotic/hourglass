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
    // Enter on a "- " or "1. " line starts the next item; on an empty item
    // it ends the list.
    property bool smartLists: false
    clip: true
    ScrollBar.vertical.policy: ScrollBar.AsNeeded

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
            const start = ta.text.lastIndexOf("\n", pos - 1) + 1;
            const line = ta.text.slice(start, pos);
            const m = /^(\s*)([-*] |(\d+)\. )/.exec(line);
            if (!m) { event.accepted = false; return; }
            if (line.trim() === m[2].trim()) { ta.remove(start, pos); return; } // empty item: end the list
            ta.insert(pos, "\n" + m[1] + (m[3] ? (+m[3] + 1) + ". " : m[2]));
        }
    }
}
